#!/usr/bin/env python3
"""End to end check of the screen flow (docs/flow-design.md sections 7 and 9).

Run it through tools/shots.sh e2e. It serves the game like tools/shots.py, opens two pages in ONE browser
context (so BroadcastChannel reaches from one to the other), walks the menu, a local game, an online room,
a leave, a wrong code and the typing guard, and writes shots/e2e.json: one entry per step with its name,
ok and the milliseconds it took.

The page names its flow screen in document.body.dataset.screen (menu, lobby, waiting, starting, game,
gameover) and the waiting room's code in the data-room-code attribute. Every wait waits for one of these
values or for a text; there are no fixed sleeps.

Exit codes: 0 every step ok, 1 a step failed, 2 the browser or the server could not start.
"""
import json
import os
import re
import sys
import time
from pathlib import Path

from shots import CHROMIUM_ARGS, ROOT, SETUP_HELP, clip, load_config, start_server, stop_server

VIEWPORT = {"width": 1280, "height": 720}
QUALITY = "low"
# The first load builds the 3D world in software rendering, which is slow.
LOAD_TIMEOUT_MS = 90000
# Waits for things that follow a click at once (a screen change on the same page).
CLICK_TIMEOUT_MS = 10000
WRONG_CODE = "ZZZZZ"
GUARD_KEYS = "cfzhv"
CONFIG_JS = ROOT / "src" / "config.js"
STRINGS_JS = ROOT / "src" / "ui" / "strings.js"
OUT_DIR = ROOT / "shots"


def read_numbers(path=CONFIG_JS):
    """The plain number constants of src/config.js (export const NAME = 123;)."""
    text = Path(path).read_text(encoding="utf-8")
    return {m.group(1): float(m.group(2)) for m in re.finditer(r"export const (\w+) = (-?\d+(?:\.\d+)?)\s*;", text)}


def read_string(key, path=STRINGS_JS):
    """One plain single quoted text of STRINGS in src/ui/strings.js."""
    m = re.search(r"\b%s: '([^']*)'" % re.escape(key), Path(path).read_text(encoding="utf-8"))
    if not m:
        raise ValueError("no text %s in %s" % (key, path))
    return m.group(1)


class StepFailed(Exception):
    pass


def check(cond, why):
    if not cond:
        raise StepFailed(why)


def screen_of(page):
    return page.evaluate("() => document.body.dataset.screen || null")


def wait_screen(page, value, timeout_ms):
    """Waits until the page shows the flow screen value; returns the milliseconds it took."""
    t = time.time()
    try:
        page.wait_for_function("(v) => document.body.dataset.screen === v", arg=value, timeout=timeout_ms)
    except Exception:
        raise StepFailed("screen %s not reached within %d ms (it is %s)" % (value, timeout_ms, screen_of(page)))
    return (time.time() - t) * 1000


def box(page, name):
    return page.locator('[data-hud-box="%s"]' % name)


def click_box(page, name):
    box(page, name).click(timeout=CLICK_TIMEOUT_MS)


def wait_text(page, selector, text, timeout_ms, why):
    try:
        page.wait_for_function(
            "([sel, text]) => (document.querySelector(sel)?.textContent || '').includes(text)",
            arg=[selector, text], timeout=timeout_ms)
    except Exception:
        raise StepFailed(why)


def open_game(context, base, errors, label):
    page = context.new_page()
    page.on("console", lambda msg: msg.type == "error" and errors.append("%s console: %s" % (label, clip(msg.text))))
    page.on("pageerror", lambda exc: errors.append("%s page error: %s" % (label, clip(exc))))
    # transport=broadcast: the pages talk over BroadcastChannel whatever
    # ONLINE_TRANSPORT says (the parameter works only on localhost).
    page.goto("%s/index.html?quality=%s&transport=broadcast" % (base, QUALITY))
    wait_screen(page, "menu", LOAD_TIMEOUT_MS)
    return page


def run_steps(context, base, numbers, steps, errors):
    peer_timeout = numbers["PEER_TIMEOUT_MS"]
    countdown_s = numbers["LEAVE_COUNTDOWN_S"]
    join_timeout = numbers["JOIN_TIMEOUT_MS"]
    code_length = int(numbers["ROOM_CODE_LENGTH"])
    pages = {}
    shared = {}

    def step1():
        a = open_game(context, base, errors, "A")
        pages["a"] = a
        names = ("menu-play-online", "menu-play-local", "menu-watch", "menu-howto", "menu-settings")
        found = [n for n in names if box(a, n).count() == 1 and box(a, n).is_visible()]
        check(len(found) == 5, "menu buttons found: %s" % ", ".join(found))
        return "5 menu buttons"

    def step2():
        a = pages["a"]
        click_box(a, "menu-play-local")
        wait_screen(a, "game", CLICK_TIMEOUT_MS)
        a.reload()
        wait_screen(a, "menu", LOAD_TIMEOUT_MS)
        return "game, then menu after reload"

    def step3():
        a = pages["a"]
        click_box(a, "menu-play-online")
        wait_screen(a, "lobby", CLICK_TIMEOUT_MS)
        click_box(a, "lobby-create")
        wait_screen(a, "waiting", CLICK_TIMEOUT_MS)
        click_box(a, "pick-host-wind-rabbit")
        code = a.locator("#room-code").get_attribute("data-room-code") or ""
        check(len(code) == code_length, "room code %r is not %d characters" % (code, code_length))
        shared["code"] = code
        return "code %s" % code

    def step4():
        a = pages["a"]
        b = open_game(context, base, errors, "B")
        pages["b"] = b
        click_box(b, "menu-play-online")
        wait_screen(b, "lobby", CLICK_TIMEOUT_MS)
        click_box(b, "lobby-join")
        code = shared["code"]
        typed = (code[:2] + " " + code[2:]).lower()
        box(b, "join-code").press_sequentially(typed)
        value = box(b, "join-code").input_value()
        check(value == code, "the code box shows %r after typing %r" % (value, typed))
        click_box(b, "join-submit")
        starting_ms = wait_screen(a, "starting", 2000)
        wait_screen(b, "starting", CLICK_TIMEOUT_MS)
        # The character select: B picks the other character, both press Ready; the host starts the game.
        click_box(b, "pick-guest-earth-bear")
        click_box(b, "ready-guest")
        click_box(a, "ready-host")
        limit = 1500
        t = time.time()
        wait_screen(a, "game", limit)
        wait_screen(b, "game", max(1, limit - (time.time() - t) * 1000))
        game_ms = (time.time() - t) * 1000
        a.screenshot(path=str(OUT_DIR / "e2e-host.png"))
        b.screenshot(path=str(OUT_DIR / "e2e-guest.png"))
        return "typed %r; starting after %d ms, both in game %d ms after both Ready" % (typed, starting_ms, game_ms)

    def step5():
        a = pages["a"]
        pages.pop("b").close()
        t = time.time()
        wait_text(a, '[data-hud-box="turn"]', "You win in", peer_timeout + 2000,
                  "no leave countdown within %d ms" % (peer_timeout + 2000))
        countdown_ms = (time.time() - t) * 1000
        over_ms = wait_screen(a, "gameover", countdown_s * 1000 + 3000)
        rematch = box(a, "gameover-rematch")
        check(rematch.is_disabled(), "Rematch is enabled after the opponent left")
        hint = a.locator("#over-hint").text_content() or ""
        gone = read_string("rematchGoneHint")
        check(hint.strip() == gone, "the rematch hint is %r, not %r" % (hint, gone))
        click_box(a, "gameover-menu")
        wait_screen(a, "menu", CLICK_TIMEOUT_MS)
        return "countdown after %d ms, game over %d ms later" % (countdown_ms, over_ms)

    def step6():
        a = pages["a"]
        click_box(a, "menu-play-online")
        wait_screen(a, "lobby", CLICK_TIMEOUT_MS)
        click_box(a, "lobby-join")
        box(a, "join-code").press_sequentially(WRONG_CODE)
        click_box(a, "join-submit")
        expected = read_string("joinErrorNotFound").replace("{code}", WRONG_CODE)
        t = time.time()
        wait_text(a, "#join-error", expected, join_timeout + 1000,
                  "no not found error within %d ms" % (join_timeout + 1000))
        return "error after %d ms" % ((time.time() - t) * 1000)

    def step7():
        a = pages["a"]
        snapshot = """() => ({
          screen: document.body.dataset.screen,
          fullscreen: document.fullscreenElement !== null,
          joinShown: !document.querySelector('[data-hud-box="join-panel"]').hidden,
          storage: JSON.stringify(Object.entries(localStorage).sort()),
        })"""
        field = box(a, "join-code")
        field.fill("")
        field.focus()
        before = a.evaluate(snapshot)
        a.keyboard.type(GUARD_KEYS)
        after = a.evaluate(snapshot)
        value = field.input_value()
        check(value == GUARD_KEYS.upper(), "the code box shows %r" % value)
        check(before == after and after["screen"] == "lobby", "the page changed: %s -> %s" % (before, after))
        return "box %s, screen %s" % (value, after["screen"])

    def console_step():
        check(not errors, "; ".join(errors[:6]))
        return "0 console errors on both pages"

    plan = [("menu", step1), ("local-and-reload", step2), ("create-room", step3), ("join-and-start", step4),
            ("leave-countdown-gameover", step5), ("wrong-code", step6), ("typing-guard", step7),
            ("console-errors", console_step)]
    failed = False
    for name, fn in plan:
        if failed and name != "console-errors":
            steps.append({"name": name, "ok": False, "ms": 0, "detail": "not run: an earlier step failed"})
            print("  %-26s %-4s %7d ms  %s" % (name, "FAIL", 0, steps[-1]["detail"]))
            continue
        t = time.time()
        try:
            detail, ok = fn(), True
        except Exception as exc:  # a failed check, or a Playwright timeout
            detail, ok = clip(exc, 400), False
        failed = failed or not ok
        steps.append({"name": name, "ok": ok, "ms": round((time.time() - t) * 1000), "detail": detail})
        print("  %-26s %-4s %7d ms  %s" % (name, "ok" if ok else "FAIL", steps[-1]["ms"], detail))


def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(SETUP_HELP.format(why="the Python module playwright is not installed for this Python."), file=sys.stderr)
        return 2
    cfg = load_config()
    numbers = read_numbers()
    OUT_DIR.mkdir(exist_ok=True)
    steps, errors = [], []
    try:
        proc, log, base = start_server(cfg, OUT_DIR / "e2e-server.log")
    except RuntimeError as exc:
        print("E2E CANNOT RUN: %s" % exc, file=sys.stderr)
        return 2
    try:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(args=CHROMIUM_ARGS, executable_path=os.environ.get("PW_CHROMIUM") or None)
            except Exception as exc:
                print(SETUP_HELP.format(why="Chromium did not start.\n" + "\n".join(str(exc).split("\n")[:6])), file=sys.stderr)
                return 2
            context = browser.new_context(viewport=VIEWPORT, reduced_motion="reduce")
            print("Flow end to end check on %s (quality %s, %dx%d) ..." % (base, QUALITY, VIEWPORT["width"], VIEWPORT["height"]))
            run_steps(context, base, numbers, steps, errors)
            browser.close()
    finally:
        stop_server(proc, log)
    ok = all(s["ok"] for s in steps)
    report = {"tool": "flow_e2e", "version": 1, "ok": ok, "quality": QUALITY, "viewport": VIEWPORT,
              "consoleErrors": len(errors), "errors": errors, "steps": steps}
    (OUT_DIR / "e2e.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("E2E %s: %d of %d steps ok. Report: shots/e2e.json" % ("OK" if ok else "FAILED", sum(s["ok"] for s in steps), len(steps)))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
