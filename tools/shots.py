#!/usr/bin/env python3
"""Screenshot self-check for Gomoku Tales (contract: docs/shots.md).

Run it through tools/shots.sh. It starts the game's page in headless Chromium (software WebGL), takes pictures
at several quality levels and window shapes, measures a few things in the pictures and in the page, and writes
shots/report.json next to the PNG files.

The helpers at the top are pure and are unit tested in tools/test_shots.py without a browser.
Game specific settings live in tools/shots.config.json, not in this file.
"""
import argparse
import base64
import itertools
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
ROOT = TOOLS_DIR.parent
CONFIG_PATH = TOOLS_DIR / "shots.config.json"

CHROMIUM_ARGS = [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
]

LEVELS = ("low", "medium", "high")

# Window shapes: name -> (width, height). Real browser window sizes, device pixel ratio 1.
SHAPES = {
    "hd": (1280, 720),  # 16:9
    "fhd": (1920, 1080),  # 16:9, the size the HUD limits are written for
    "wide": (1680, 720),  # 21:9
    "tablet": (1024, 768),  # 4:3
    "small": (800, 600),  # 4:3, small laptop window
    "portrait": (720, 1280),  # 9:16
    "phone": (390, 844),  # about 9:19.5
}

DEFAULT_CONFIG = {
    # Command that serves the game. {port} and {python} are replaced. Runs inside "cwd" (relative to the repo root).
    "serve": ["{python}", "-m", "http.server", "{port}", "--bind", "127.0.0.1"],
    "cwd": ".",
    # Path of the page that starts the game, from the web root of the server.
    "entry": "/index.html",
    "server_wait_s": 30,
    # How long to wait for window.__SHOT__.ready (software rendering is slow, High quality is the slowest).
    "ready_timeout_s": 120,
    # false: black edges, a canvas that does not cover the window and scroll bars are warnings.
    # true: they are problems. Switch it to true when the full window view works (part 1 of v3.1).
    "strict_window": False,
    # Largest share of near black pixels allowed in a 4 px band along one edge of the picture.
    "edge_max_share": 0.02,
    # Largest share of pixels that may change between two pictures taken 1.2 s apart.
    "stable_max_share": 0.01,
    # Requests that may fail without being a problem.
    "ignore_urls": ["/favicon.ico"],
}

# Flow screens (docs/flow-design.md section 7): the scenes of the flow set, drawn at these window shapes.
# In these scenes every visible button must be at least MIN_BUTTON_SIDE px on both sides.
FLOW_SCENES = ("menu", "howto", "settings")
FLOW_SHAPES = ("fhd", "hd")
MIN_BUTTON_SIDE = 44

EDGE_BAND_PX = 4
NEAR_BLACK = 16
STABLE_WAIT_MS = 1200
MAX_MESSAGES = 6


# ------------------------------------------------------------------ pure helpers


def parse_kv(items):
    """['hud=collapsed', 'a=b'] -> {'hud': 'collapsed', 'a': 'b'}. Raises ValueError on a bad item."""
    out = {}
    for item in items or []:
        if "=" not in item:
            raise ValueError("expected key=value, got: " + item)
        key, value = item.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", key):
            raise ValueError("bad parameter name: " + key)
        out[key] = value.strip()
    return out


def make_shot(quality, shape, scene="field", params=None):
    if quality not in LEVELS:
        raise ValueError("unknown quality: %s (use %s)" % (quality, ", ".join(LEVELS)))
    if shape not in SHAPES:
        raise ValueError("unknown shape: %s (use %s)" % (shape, ", ".join(SHAPES)))
    if not re.fullmatch(r"[a-z][a-z0-9-]*", scene):
        raise ValueError("bad scene name: " + scene)
    return {"quality": quality, "shape": shape, "scene": scene, "params": dict(params or {})}


def shot_name(shot):
    parts = [shot["quality"], shot["shape"], shot["scene"]]
    for key in sorted(shot["params"]):
        parts.append(key + "-" + shot["params"][key])
    return re.sub(r"[^a-z0-9-]+", "-", "-".join(parts).lower()).strip("-")


def shot_query(shot):
    q = {"shot": shot["scene"], "quality": shot["quality"]}
    q.update(shot["params"])
    return urllib.parse.urlencode(q)


def named_sets():
    """The ready made sets. Every item is (quality, shape, params) or (quality, shape, params, scene);
    without a scene the item uses the scene of the command line."""
    levels = [(q, "hd", {}) for q in LEVELS]
    shapes = [("medium", s, {}) for s in ("wide", "hd", "tablet", "portrait", "phone")]
    hud = [
        ("medium", "fhd", {"hud": "expanded"}),
        ("medium", "fhd", {"hud": "collapsed"}),
        ("medium", "small", {"hud": "expanded"}),
        ("medium", "small", {"hud": "collapsed"}),
        ("medium", "phone", {}),
    ]
    full = list(levels)
    for item in shapes:
        if item not in full:
            full.append(item)
    return {
        "quick": [("high", "hd", {})],
        "levels": levels,
        "shapes": shapes,
        "hud": hud,
        "full": full,
        "flow": [("medium", shape, {}, scene) for scene in FLOW_SCENES for shape in FLOW_SHAPES],
    }


def plan_shots(set_name=None, qualities=None, shapes=None, scene="field", params=None):
    """Returns a list of shot dicts. Either a named set, or the product of qualities and shapes."""
    shots = []
    if set_name:
        sets = named_sets()
        if set_name not in sets:
            raise ValueError("unknown set: %s (use %s)" % (set_name, ", ".join(sets)))
        for item in sets[set_name]:
            quality, shape, extra = item[:3]
            merged = dict(extra)
            merged.update(params or {})
            shots.append(make_shot(quality, shape, item[3] if len(item) > 3 else scene, merged))
    else:
        for quality, shape in itertools.product(qualities or ["high"], shapes or ["hd"]):
            shots.append(make_shot(quality, shape, scene, params))
    names = [shot_name(s) for s in shots]
    if len(set(names)) != len(names):
        raise ValueError("two shots would have the same file name")
    return shots


def rect_contains(a, b, tol=1.0):
    """True when rectangle a contains rectangle b (rectangles are dicts with x, y, w, h)."""
    return (
        a["x"] <= b["x"] + tol
        and a["y"] <= b["y"] + tol
        and a["x"] + a["w"] >= b["x"] + b["w"] - tol
        and a["y"] + a["h"] >= b["y"] + b["h"] - tol
    )


def find_overlaps(boxes, tol=1.0):
    """Pairs of boxes that overlap by more than tol pixels in both directions, ignoring a box inside another."""
    found = []
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i], boxes[j]
            dx = min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"])
            dy = min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"])
            if dx > tol and dy > tol and not rect_contains(a, b, tol) and not rect_contains(b, a, tol):
                found.append((a["name"], b["name"]))
    return found


def find_outside(boxes, width, height, tol=1.0):
    """Names of boxes that stick out of the window."""
    out = []
    for b in boxes:
        if b["x"] < -tol or b["y"] < -tol or b["x"] + b["w"] > width + tol or b["y"] + b["h"] > height + tol:
            out.append(b["name"])
    return out


def smallest_button(buttons):
    """(side, name) of the smallest side of the visible buttons, or (None, None) when there are none."""
    best = (None, None)
    for b in buttons or []:
        side = min(b["w"], b["h"])
        if best[0] is None or side < best[0]:
            best = (side, b["name"])
    return best


def judge(m, cfg):
    """Turns raw measurements of one shot into (problems, warnings). Both are lists of plain sentences."""
    problems = []
    warnings = []
    w, h = m["viewport"]["w"], m["viewport"]["h"]

    if m.get("error"):
        problems.append(m["error"])
    for text in m.get("consoleErrors", []):
        problems.append("console error: " + text)
    for text in m.get("pageErrors", []):
        problems.append("page error: " + text)
    for text in m.get("failedRequests", []):
        problems.append("failed request: " + text)

    shot = m.get("shot")
    if m.get("error") is None and shot is None:
        problems.append("window.__SHOT__ is missing: shot mode is not in the game yet (docs/shots.md, Page contract)")
    if shot:
        if shot.get("renderer") == "2d":
            problems.append("the game fell back to the 2D renderer, so WebGL did not start in this browser")
        if shot.get("renderer") is None:
            warnings.append("window.__SHOT__.renderer is not set (should be 3d or 2d)")
        if shot.get("quality") not in (None, m["quality"]):
            problems.append("quality is %s but the shot asked for %s" % (shot.get("quality"), m["quality"]))

    boxes = m.get("hudBoxes", [])
    for a, b in find_overlaps(boxes):
        problems.append("HUD boxes overlap: %s and %s" % (a, b))
    for name in find_outside(boxes, w, h):
        problems.append("HUD box sticks out of the window: " + name)
    side, name = smallest_button(m.get("buttons"))
    if m.get("scene") in FLOW_SCENES and side is not None and side < MIN_BUTTON_SIDE - 0.5:
        problems.append("button %s is %.1f px on its smallest side (at least %d)" % (name, side, MIN_BUTTON_SIDE))

    window_notes = []
    for side, share in (m.get("edges") or {}).items():
        if share > cfg["edge_max_share"]:
            window_notes.append("black bar on the %s edge (%.0f percent of the edge is near black)" % (side, share * 100))
    canvas = m.get("canvas")
    if canvas is None:
        window_notes.append("no canvas found")
    elif abs(canvas["w"] - w) > 1 or abs(canvas["h"] - h) > 1 or abs(canvas["x"]) > 1 or abs(canvas["y"]) > 1:
        window_notes.append(
            "the canvas is %dx%d at (%d,%d) and does not cover the %dx%d window"
            % (canvas["w"], canvas["h"], canvas["x"], canvas["y"], w, h)
        )
    scroll = m.get("scroll")
    if scroll and (scroll["w"] > w + 1 or scroll["h"] > h + 1):
        window_notes.append("the page can scroll (content %dx%d in a %dx%d window)" % (scroll["w"], scroll["h"], w, h))
    (problems if cfg["strict_window"] else warnings).extend(window_notes)

    diff = m.get("stableDiff")
    if diff is not None and diff > cfg["stable_max_share"]:
        problems.append(
            "the picture is not still: %.1f percent of the pixels changed in %.1f s (limit %.1f percent); "
            "a clock or a random source is not frozen in shot mode" % (diff * 100, STABLE_WAIT_MS / 1000.0, cfg["stable_max_share"] * 100)
        )
    return problems, warnings


def load_config(path=CONFIG_PATH):
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if Path(path).exists():
        with open(path, "r", encoding="utf-8") as fh:
            user = json.load(fh)
        for key, value in user.items():
            if key.startswith("_"):
                continue
            if key not in cfg:
                raise ValueError("unknown key in %s: %s" % (Path(path).name, key))
            cfg[key] = value
    return cfg


# ------------------------------------------------------------------ browser side scripts

JS_PAGE_INFO = """() => {
  const round = (n) => Math.round(n * 10) / 10;
  const boxes = [];
  for (const el of document.querySelectorAll('[data-hud-box]')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.01) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    boxes.push({ name: el.getAttribute('data-hud-box') || el.id || el.tagName.toLowerCase(),
                 x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) });
  }
  // Every visible button element, for the smallest button side.
  const buttons = [];
  for (const el of document.querySelectorAll('button')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.01) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    buttons.push({ name: el.getAttribute('data-hud-box') || (el.textContent || '').trim().slice(0, 30) || 'button',
                   x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) });
  }
  let canvas = null, best = 0;
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width * r.height > best) {
      best = r.width * r.height;
      canvas = { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height), attrW: c.width, attrH: c.height };
    }
  }
  const de = document.documentElement;
  let shot = null;
  try { shot = window.__SHOT__ ? JSON.parse(JSON.stringify(window.__SHOT__)) : null; } catch (e) { shot = null; }
  return { vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, boxes, buttons, canvas,
           scroll: { w: de.scrollWidth, h: de.scrollHeight }, shot };
}"""

JS_ANALYZE = """async (o) => {
  const load = async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  };
  const A = await load(o.a);
  const W = A.width, H = A.height, d = A.data;
  const dark = (i) => Math.max(d[i], d[i + 1], d[i + 2]) < o.nearBlack;
  const band = o.band;
  const share = (xs, xe, ys, ye) => {
    let n = 0, t = 0;
    for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) { t++; if (dark((y * W + x) * 4)) n++; }
    return t ? n / t : 0;
  };
  const edges = {
    left: share(0, Math.min(band, W), 0, H), right: share(Math.max(0, W - band), W, 0, H),
    top: share(0, W, 0, Math.min(band, H)), bottom: share(0, W, Math.max(0, H - band), H),
  };
  // Horizon sharpness: the largest change of the average brightness between two neighbouring rows
  // in the middle columns, from 12 percent to 60 percent of the height. A hard line gives a big number.
  const y0 = Math.floor(H * 0.12), y1 = Math.floor(H * 0.60), x0 = Math.floor(W * 0.30), x1 = Math.floor(W * 0.70);
  const rows = [];
  for (let y = y0; y < y1; y++) {
    let s = 0, n = 0;
    for (let x = x0; x < x1; x += 4) { const i = (y * W + x) * 4; s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    rows.push(n ? s / n : 0);
  }
  let step = 0, at = 0;
  for (let k = 1; k < rows.length; k++) { const v = Math.abs(rows[k] - rows[k - 1]); if (v > step) { step = v; at = (y0 + k) / H; } }
  let stableDiff = null;
  if (o.b) {
    const B = await load(o.b);
    if (B.width === W && B.height === H) {
      let changed = 0;
      const e = B.data;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.max(Math.abs(d[i] - e[i]), Math.abs(d[i + 1] - e[i + 1]), Math.abs(d[i + 2] - e[i + 2])) > o.diffLevel) changed++;
      }
      stableDiff = changed / (W * H);
    }
  }
  return { w: W, h: H, edges, horizon: { step: Math.round(step * 100) / 100, at: Math.round(at * 1000) / 1000 }, stableDiff };
}"""


# ------------------------------------------------------------------ runner


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(cfg, log_path):
    port = free_port()
    cmd = [str(a).replace("{port}", str(port)).replace("{python}", sys.executable) for a in cfg["serve"]]
    cwd = (ROOT / cfg["cwd"]).resolve()
    log = open(log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(cmd, cwd=str(cwd), stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = "http://127.0.0.1:%d" % port
    deadline = time.time() + cfg["server_wait_s"]
    last = None
    while time.time() < deadline:
        if proc.poll() is not None:
            break
        try:
            with urllib.request.urlopen(base + cfg["entry"], timeout=2) as resp:
                if 200 <= resp.status < 400:
                    return proc, log, base
        except Exception as exc:  # the server is not ready yet
            last = exc
        time.sleep(0.25)
    stop_server(proc, log)
    tail = ""
    try:
        tail = Path(log_path).read_text(encoding="utf-8", errors="replace")[-600:]
    except OSError:
        pass
    raise RuntimeError(
        "the game server did not answer on %s%s (command: %s). Last error: %s. Server output: %s"
        % (base, cfg["entry"], " ".join(cmd), last, tail.strip() or "(none)")
    )


def stop_server(proc, log):
    if proc is None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    if log:
        log.close()


def clip(text, n=300):
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 3] + "..."


def take_shot(browser, analyzer, shot, base, cfg, out_dir):
    width, height = SHAPES[shot["shape"]]
    name = shot_name(shot)
    url = base + cfg["entry"] + "?" + shot_query(shot)
    m = {
        "name": name,
        "file": name + ".png",
        "quality": shot["quality"],
        "shape": shot["shape"],
        "scene": shot["scene"],
        "params": shot["params"],
        "url": url,
        "viewport": {"w": width, "h": height},
        "consoleErrors": [],
        "pageErrors": [],
        "failedRequests": [],
        "error": None,
    }
    ignore = tuple(cfg["ignore_urls"])
    ctx = browser.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=1,
        reduced_motion="reduce",
        color_scheme="light",
        locale="en-US",
    )
    page = ctx.new_page()

    def on_console(msg):
        # "Failed to load resource" lines are reported with their address by on_response below.
        if msg.type == "error" and not msg.text.startswith("Failed to load resource") and len(m["consoleErrors"]) < MAX_MESSAGES:
            m["consoleErrors"].append(clip(msg.text))

    def on_pageerror(err):
        if len(m["pageErrors"]) < MAX_MESSAGES:
            m["pageErrors"].append(clip(err))

    def on_response(resp):
        if resp.status >= 400 and not resp.url.endswith(ignore) and len(m["failedRequests"]) < MAX_MESSAGES:
            m["failedRequests"].append("%d %s" % (resp.status, resp.url))

    def on_requestfailed(req):
        reason = req.failure or ""
        if "ABORTED" in str(reason).upper():
            return
        if not req.url.endswith(ignore) and len(m["failedRequests"]) < MAX_MESSAGES:
            m["failedRequests"].append("%s %s" % (reason or "failed", req.url))

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    page.on("response", on_response)
    page.on("requestfailed", on_requestfailed)

    started = time.time()
    shot_timeout = int(cfg["ready_timeout_s"] * 1000)  # one slow software frame can take many seconds
    png_a = png_b = None
    try:
        page.goto(url, wait_until="load", timeout=max(60000, int(cfg["ready_timeout_s"] * 1000)))
        try:
            page.wait_for_function("window.__SHOT__ !== undefined", timeout=15000)
        except Exception:
            m["error"] = None  # reported by judge as a missing shot mode
        else:
            try:
                page.wait_for_function("window.__SHOT__.ready === true", timeout=int(cfg["ready_timeout_s"] * 1000))
            except Exception:
                m["error"] = "window.__SHOT__.ready did not become true within %d s" % cfg["ready_timeout_s"]
        page.evaluate("document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true")
        page.wait_for_timeout(300)
        png_a = page.screenshot(timeout=shot_timeout)
        info = page.evaluate(JS_PAGE_INFO)
        page.wait_for_timeout(STABLE_WAIT_MS)
        png_b = page.screenshot(timeout=shot_timeout)
    except Exception as exc:
        m["error"] = "the page did not load or could not be photographed: " + clip(exc, 400)
        info = None
    m["ready_s"] = round(time.time() - started, 1)
    ctx.close()

    if info:
        m["canvas"] = info["canvas"]
        m["scroll"] = info["scroll"]
        m["hudBoxes"] = info["boxes"][:60]
        m["buttons"] = info["buttons"][:60]
        m["shot"] = info["shot"]
        m["dpr"] = info["dpr"]
    else:
        m["shot"] = None
    if png_a:
        (out_dir / m["file"]).write_bytes(png_a)
        res = analyzer.evaluate(
            JS_ANALYZE,
            {
                "a": base64.b64encode(png_a).decode("ascii"),
                "b": base64.b64encode(png_b).decode("ascii") if png_b else None,
                "band": EDGE_BAND_PX,
                "nearBlack": NEAR_BLACK,
                "diffLevel": 12,
            },
        )
        m["edges"] = {k: round(v, 4) for k, v in res["edges"].items()}
        m["horizon"] = res["horizon"]
        m["stableDiff"] = None if res["stableDiff"] is None else round(res["stableDiff"], 5)
        m["pixels"] = {"w": res["w"], "h": res["h"]}
    m["problems"], m["warnings"] = judge(m, cfg)
    boxes = m.get("hudBoxes", [])
    m["overlaps"] = [list(pair) for pair in find_overlaps(boxes)]
    m["outside"] = find_outside(boxes, width, height)
    m["minButtonSide"], m["minButtonName"] = smallest_button(m.get("buttons"))
    return m


def prepare_out(out_dir):
    shots_root = (ROOT / "shots").resolve()
    out_dir = Path(out_dir)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir
    out_dir = out_dir.resolve()
    if out_dir != shots_root and shots_root not in out_dir.parents:
        raise ValueError("--out must be inside the shots folder of the repo (%s)" % shots_root)
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in list(out_dir.glob("*.png")) + [out_dir / "report.json", out_dir / "server.log"]:
        if old.exists():
            old.unlink()
    return out_dir


SETUP_HELP = """SHOTS TOOL NOT READY: {why}
One-time setup (outside the repo):
  mkdir -p ~/tools/shots && cd ~/tools/shots && python3 -m venv venv
  venv/bin/pip install playwright
  venv/bin/playwright install chromium
  sudo venv/bin/playwright install-deps chromium
Then run the same command again. If screenshots cannot run, continue without them and say so in the summary:
never claim a visual check you did not do."""


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Take pictures of the running game and measure them (docs/shots.md).",
        epilog="Sets: " + ", ".join(named_sets()) + ". Shapes: " + ", ".join("%s=%dx%d" % (k, v[0], v[1]) for k, v in SHAPES.items()),
    )
    ap.add_argument("--set", dest="set_name", help="quick, levels, shapes, hud, full or flow")
    ap.add_argument("--quality", help="low, medium or high; a comma separated list is allowed")
    ap.add_argument("--shape", help="window shape; a comma separated list is allowed")
    ap.add_argument("--scene", default="field", help="scene name for the shot parameter (default field)")
    ap.add_argument("--param", action="append", default=[], help="extra URL parameter key=value, can be repeated")
    ap.add_argument("--out", default="shots", help="output folder inside the repo shots folder (default shots)")
    ap.add_argument("--url", help="use a game server that is already running, for example http://127.0.0.1:8000")
    ap.add_argument("--list", action="store_true", help="print the planned shots and stop")
    args = ap.parse_args(argv)

    try:
        cfg = load_config()
        params = parse_kv(args.param)
        if args.set_name and (args.quality or args.shape):
            raise ValueError("use --set or --quality/--shape, not both")
        if args.set_name:
            shots = plan_shots(set_name=args.set_name, scene=args.scene, params=params)
        elif args.quality or args.shape:
            shots = plan_shots(
                qualities=[q for q in (args.quality or "high").split(",") if q],
                shapes=[s for s in (args.shape or "hd").split(",") if s],
                scene=args.scene,
                params=params,
            )
        else:
            shots = plan_shots(set_name="quick", scene=args.scene, params=params)
    except (ValueError, OSError) as exc:
        print("SHOTS USAGE ERROR: %s" % exc, file=sys.stderr)
        return 2

    if args.list:
        for s in shots:
            print("%-40s %dx%d  ?%s" % (shot_name(s), SHAPES[s["shape"]][0], SHAPES[s["shape"]][1], shot_query(s)))
        return 0

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(SETUP_HELP.format(why="the Python module playwright is not installed for this Python."), file=sys.stderr)
        return 2

    try:
        out_dir = prepare_out(args.out)
    except ValueError as exc:
        print("SHOTS USAGE ERROR: %s" % exc, file=sys.stderr)
        return 2

    proc = log = None
    results = []
    try:
        if args.url:
            base = args.url.rstrip("/")
        else:
            try:
                proc, log, base = start_server(cfg, out_dir / "server.log")
            except RuntimeError as exc:
                print("SHOTS CANNOT RUN: %s" % exc, file=sys.stderr)
                print("Fix serve, cwd and entry in tools/shots.config.json (docs/shots.md).", file=sys.stderr)
                return 2
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(args=CHROMIUM_ARGS, executable_path=os.environ.get("PW_CHROMIUM") or None)
            except Exception as exc:
                first = "\n".join(str(exc).split("\n")[:6])
                print(SETUP_HELP.format(why="Chromium did not start.\n" + first), file=sys.stderr)
                return 2
            analyzer = browser.new_page()
            print("Taking %d shot(s) from %s ..." % (len(shots), base))
            for shot in shots:
                t = time.time()
                m = take_shot(browser, analyzer, shot, base, cfg, out_dir)
                results.append(m)
                state = "ok" if not m["problems"] else "%d problem(s)" % len(m["problems"])
                if m["warnings"]:
                    state += ", %d warning(s)" % len(m["warnings"])
                print("  %-34s %4dx%-4d %5.1fs  %s" % (m["file"], m["viewport"]["w"], m["viewport"]["h"], time.time() - t, state))
                for text in m["problems"]:
                    print("      PROBLEM: " + text)
                for text in m["warnings"]:
                    print("      warning: " + text)
            browser.close()
    finally:
        stop_server(proc, log)

    n_problems = sum(len(r["problems"]) for r in results)
    n_warnings = sum(len(r["warnings"]) for r in results)
    report = {
        "tool": "shots",
        "version": 1,
        "ok": n_problems == 0,
        "problems": n_problems,
        "warnings": n_warnings,
        "strict_window": cfg["strict_window"],
        "shots": results,
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    rel = os.path.relpath(out_dir, ROOT)
    print()
    print("Horizon step (largest brightness jump between neighbouring rows, middle columns; a hard line gives a big number):")
    for r in results:
        if "horizon" in r:
            print("  %-34s %6.2f at %.0f percent of the height" % (r["file"], r["horizon"]["step"], r["horizon"]["at"] * 100))
    print()
    print("Boxes and buttons (overlapping pairs, boxes outside the window, smallest button side in px):")
    for r in results:
        side = r.get("minButtonSide")
        print("  %-34s overlaps %d, outside %d, smallest button %s" % (
            r["file"], len(r.get("overlaps", [])), len(r.get("outside", [])), "-" if side is None else "%.1f" % side))
    print()
    if n_problems == 0:
        print("SHOTS OK: %d shot(s), %d warning(s). Report: %s/report.json" % (len(results), n_warnings, rel))
        return 0
    print("SHOTS PROBLEMS: %d problem(s), %d warning(s) in %d shot(s). Report: %s/report.json" % (n_problems, n_warnings, len(results), rel))
    return 1


if __name__ == "__main__":
    sys.exit(main())
