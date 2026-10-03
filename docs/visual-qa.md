# Visual QA checklist (Farmland v3)

For the game's owner, after the last Farmland v3 task. Tests cannot judge how
the scene looks, so this is checked by eye in a browser. The checklist is
copied from docs/art-direction-v3.md section 11; that section stays the
source of truth.

## How to open the game

1. In the project folder run `python3 -m http.server 8000`.
2. Open `http://localhost:8000/?local=1&quality=low`, then
   `quality=medium`, then `quality=high` (or press Q in the game to step
   through the levels). `?local=1` lets one window play both sides.
3. Open the browser's developer console (F12) before loading each level.
4. Compare each level with `docs/reference/v3/scene-low.jpg`,
   `scene-medium.jpg` and `scene-high.jpg`, and the HUD with
   `docs/reference/v3/hud-quality.png`.

For the online screens, open `http://localhost:8000/` in two windows of the
same browser profile (see docs/testing.md).

## Checklist

1. [ ] Low, Medium and High look clearly different and each matches its `scene-*.jpg` in spirit.
2. [ ] Plant a seed: it drops, lands, sprouts and opens in about 1.2 seconds, X is a blue four-petal cross and O is a red round bloom.
3. [ ] Five in a row: the winning plants show the gold sparkle mark.
4. [ ] Clouds drift only on High. No straight streak lines anywhere.
5. [ ] Flowers appear in drifts of one kind, never on a plot.
6. [ ] The cards look like frosted glass on High, solid on Low.
7. [ ] Every skill still works, with cooldown rings.
8. [ ] No console errors.

## Also worth a look after the cleanup (part 10)

- The only wood is the curb around the field and the fence. The lobby,
  Create Room, Join Room, Waiting and Game over screens are dark glass cards
  now, not wooden signboards.
- Nothing is missing where the old art used to be: the plots, plants, rocks,
  marks and clouds all come from the v3 pack.
- Item 8 on all three levels: on a normal load the console should show
  nothing at all, not even a failed request. The 3D game no longer requests
  the 2D renderer's art, and the page sets an empty favicon. A yellow
  warning names an art file whose size does not fit the manifest.
- `?render=2d` still plays with the old 2D look, as the fallback. It still
  uses the 2D wooden board and panels, and its missing 2D art files show as
  failed requests in the console there.
- FPS is measured separately: see "Performance results" in
  docs/art-direction-v3.md section 10.
