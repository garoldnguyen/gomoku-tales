"""Unit tests for the pure helpers of tools/shots.py. No browser needed.
Run: python3 -m unittest discover -s tools -p "test_*.py"
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import shots  # noqa: E402

CFG = {"strict_window": False, "edge_max_share": 0.02, "stable_max_share": 0.01}


def measurement(**over):
    m = {
        "quality": "medium",
        "viewport": {"w": 1280, "h": 720},
        "shot": {"scene": "field", "quality": "medium", "renderer": "3d", "ready": True},
        "canvas": {"x": 0, "y": 0, "w": 1280, "h": 720},
        "scroll": {"w": 1280, "h": 720},
        "edges": {"left": 0, "right": 0, "top": 0, "bottom": 0},
        "hudBoxes": [],
        "stableDiff": 0,
        "consoleErrors": [],
        "pageErrors": [],
        "failedRequests": [],
        "error": None,
    }
    m.update(over)
    return m


class ParseTests(unittest.TestCase):
    def test_parse_kv(self):
        self.assertEqual(shots.parse_kv(["hud=collapsed", "a_1=b=c"]), {"hud": "collapsed", "a_1": "b=c"})
        self.assertEqual(shots.parse_kv(None), {})

    def test_parse_kv_rejects_bad_items(self):
        with self.assertRaises(ValueError):
            shots.parse_kv(["nokey"])
        with self.assertRaises(ValueError):
            shots.parse_kv(["1bad=x"])

    def test_make_shot_validates(self):
        self.assertEqual(shots.make_shot("low", "hd")["scene"], "field")
        for args in (("ultra", "hd"), ("low", "huge"), ("low", "hd", "Bad Scene")):
            with self.assertRaises(ValueError):
                shots.make_shot(*args)

    def test_names_and_query(self):
        s = shots.make_shot("high", "wide", "field", {"hud": "collapsed"})
        self.assertEqual(shots.shot_name(s), "high-wide-field-hud-collapsed")
        self.assertEqual(shots.shot_query(s), "shot=field&quality=high&hud=collapsed")


class SetTests(unittest.TestCase):
    def test_sets_have_expected_sizes(self):
        sizes = {k: len(v) for k, v in shots.named_sets().items()}
        self.assertEqual(sizes, {"quick": 1, "levels": 3, "shapes": 5, "hud": 5, "full": 7})

    def test_every_set_plans_with_unique_names(self):
        for name in shots.named_sets():
            planned = shots.plan_shots(set_name=name)
            names = [shots.shot_name(s) for s in planned]
            self.assertEqual(len(names), len(set(names)), name)

    def test_product_of_lists(self):
        planned = shots.plan_shots(qualities=["low", "high"], shapes=["hd", "phone"])
        self.assertEqual(len(planned), 4)

    def test_unknown_set(self):
        with self.assertRaises(ValueError):
            shots.plan_shots(set_name="nope")

    def test_shapes_are_real_sizes(self):
        for name, (w, h) in shots.SHAPES.items():
            self.assertGreater(w, 200, name)
            self.assertGreater(h, 200, name)


class GeometryTests(unittest.TestCase):
    def box(self, name, x, y, w, h):
        return {"name": name, "x": x, "y": y, "w": w, "h": h}

    def test_overlap_found(self):
        a, b = self.box("a", 0, 0, 100, 100), self.box("b", 50, 50, 100, 100)
        self.assertEqual(shots.find_overlaps([a, b]), [("a", "b")])

    def test_touching_boxes_do_not_overlap(self):
        a, b = self.box("a", 0, 0, 100, 100), self.box("b", 100, 0, 100, 100)
        self.assertEqual(shots.find_overlaps([a, b]), [])

    def test_nested_boxes_are_allowed(self):
        outer, inner = self.box("outer", 0, 0, 300, 100), self.box("inner", 10, 10, 40, 40)
        self.assertEqual(shots.find_overlaps([outer, inner]), [])

    def test_outside(self):
        inside = self.box("in", 0, 0, 100, 100)
        out = self.box("out", 1200, 0, 100, 50)
        self.assertEqual(shots.find_outside([inside, out], 1280, 720), ["out"])


class JudgeTests(unittest.TestCase):
    def test_clean_shot_has_no_problems(self):
        self.assertEqual(shots.judge(measurement(), CFG), ([], []))

    def test_console_and_request_problems(self):
        p, _ = shots.judge(measurement(consoleErrors=["x"], pageErrors=["y"], failedRequests=["404 /a"]), CFG)
        self.assertEqual(len(p), 3)

    def test_missing_shot_mode(self):
        p, _ = shots.judge(measurement(shot=None), CFG)
        self.assertTrue(any("__SHOT__" in t for t in p))

    def test_fallback_renderer_and_quality_mismatch(self):
        shot = {"scene": "field", "quality": "low", "renderer": "2d"}
        p, _ = shots.judge(measurement(shot=shot), CFG)
        self.assertEqual(len(p), 2)

    def test_window_notes_are_warnings_unless_strict(self):
        m = measurement(edges={"left": 1, "right": 1, "top": 0, "bottom": 0}, scroll={"w": 2000, "h": 720},
                        canvas={"x": 100, "y": 0, "w": 1080, "h": 720})
        p, w = shots.judge(m, CFG)
        self.assertEqual((len(p), len(w)), (0, 4))
        strict = dict(CFG, strict_window=True)
        p, w = shots.judge(m, strict)
        self.assertEqual((len(p), len(w)), (4, 0))

    def test_hud_problems(self):
        boxes = [
            {"name": "a", "x": 0, "y": 0, "w": 100, "h": 100},
            {"name": "b", "x": 50, "y": 50, "w": 100, "h": 100},
            {"name": "c", "x": 1250, "y": 0, "w": 100, "h": 20},
        ]
        p, _ = shots.judge(measurement(hudBoxes=boxes), CFG)
        self.assertEqual(len(p), 2)

    def test_stable_limit(self):
        self.assertEqual(shots.judge(measurement(stableDiff=0.005), CFG)[0], [])
        self.assertEqual(len(shots.judge(measurement(stableDiff=0.2), CFG)[0]), 1)


class ConfigTests(unittest.TestCase):
    def test_defaults_when_file_is_missing(self):
        cfg = shots.load_config(Path(tempfile.gettempdir()) / "no-such-shots-config.json")
        self.assertEqual(cfg["entry"], "/index.html")

    def test_the_shipped_config_is_valid(self):
        cfg = shots.load_config(shots.CONFIG_PATH)
        self.assertTrue(cfg["entry"].startswith("/"))
        self.assertIn("{port}", " ".join(cfg["serve"]))

    def test_user_values_win_and_notes_are_ignored(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.json"
            p.write_text(json.dumps({"_note": "x", "entry": "/game.html"}))
            self.assertEqual(shots.load_config(p)["entry"], "/game.html")

    def test_unknown_key_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.json"
            p.write_text(json.dumps({"entri": "/x"}))
            with self.assertRaises(ValueError):
                shots.load_config(p)


if __name__ == "__main__":
    unittest.main()
