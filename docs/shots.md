# Screenshot self-check (shots)

The builder can look at the running game. `bash tools/shots.sh` starts the game page in headless Chromium, takes pictures at several quality levels and window shapes, measures a few things, and writes `shots/report.json` next to the PNG files. The `shots/` folder is not committed.

The tool is plain Python. It adds nothing to the repo's dependencies and nothing to the game's normal runtime.

## 1. One time setup on the owner's machine (already done)

Python Playwright lives outside the repo, in `~/tools/shots/venv`, with Chromium in `~/.cache/ms-playwright`. `tools/shots.sh` finds it by itself (it tries `SHOTS_PYTHON`, then that venv, then `python3`). If it is missing, the script prints the four setup commands and exits with code 2. In that case do the rest of the task without pictures and say so in the summary. Never claim a visual check that was not made.

## 2. Commands

```
bash tools/shots.sh                              one picture: High at 1280x720 (the quick set)
bash tools/shots.sh --set levels                 Low, Medium and High at 1280x720
bash tools/shots.sh --set shapes                 Medium at wide, hd, tablet, portrait and phone
bash tools/shots.sh --set hud                    HUD states: fhd and small expanded or collapsed, phone
bash tools/shots.sh --set full                   levels and shapes together (7 pictures)
bash tools/shots.sh e2e                          the flow end to end check (tools/flow_e2e.py, Low at 1280x720, shots/e2e.json)
bash tools/shots.sh flow                         short for --set flow (quick, levels, shapes, hud and full work the same way)
bash tools/shots.sh --set flow                   the menu, howto, settings, lobby, waiting, starting, gameover and gameover-pending scenes at fhd and hd (Medium, 16 pictures)
bash tools/shots.sh --quality high --shape wide  one custom picture (comma lists make a product)
bash tools/shots.sh --scene empty                another scene
bash tools/shots.sh --param hud=collapsed        extra URL parameter, can be repeated
bash tools/shots.sh --set levels --out shots/before    keep a baseline in a sub folder of shots/
bash tools/shots.sh --set levels --list          only print the plan
bash tools/shots.sh --url http://127.0.0.1:8000  use a server that is already running
python3 -m unittest discover -s tools -p "test_*.py"   unit tests of the tool itself
```

Window shapes (device pixel ratio 1): hd 1280x720, fhd 1920x1080, wide 1680x720 (21:9), tablet 1024x768, small 800x600, portrait 720x1280, phone 390x844.

Exit codes: 0 all good, 1 problems found, 2 the tool could not run (setup, server or usage).

Software rendering (SwiftShader) is slow: about 2 to 20 seconds per picture, High is the slowest. Take only the pictures you need.

## 3. What the report says

`shots/report.json` has one entry per picture. Read it before opening any picture.

Problems (the tool prints `PROBLEM:` and ends with `SHOTS PROBLEMS`; fix them):

- a console error, an uncaught page error, or a request that failed (status 400 or more; `/favicon.ico` is ignored)
- `window.__SHOT__` missing, `ready` not true in time, `renderer` equal to `2d` (WebGL did not start), or a `quality` that differs from the one asked for
- two HUD boxes that overlap (a box inside another box is allowed), or a HUD box that sticks out of the window
- the picture is not still: more than 1 percent of the pixels changed between two pictures 1.2 seconds apart (something is not frozen)

Window checks (warnings by default, problems when `strict_window` is true in `tools/shots.config.json`):

- `edges`: the share of near black pixels in a 4 px band along each edge. Above 0.02 means a black bar.
- `canvas` does not cover the window, or `scroll` shows the page can scroll.

Numbers to quote in a summary:

- `horizon.step`: the largest brightness jump between two neighbouring pixel rows in the middle columns, between 12 and 60 percent of the window height. A hard line between meadow and sky gives a big number (above 20), a smooth haze a small one (under 5). HUD boxes in the middle columns raise it, so compare the same shape before and after a change.
- `hudBoxes`: name, x, y, w, h of every visible `data-hud-box` element, for size limits.
- `shot.info`: free numbers the game puts in `window.__SHOT__.info`.
- `overlaps` (pairs of box names), `outside` (box names that stick out of the window) and `minButtonSide` with `minButtonName`: the smallest side in px of every visible `button` element (`buttons` lists them). In the flow scenes (`menu`, `howto`, `settings`, `lobby`, `waiting`, `starting`, `gameover`, `gameover-pending`) a button under 44 px is a problem. The tool prints these three per picture at the end.
- `cardShare` (the `gameover` scenes only): the height of the box `gameover-card` as a share of the window height. Above 0.24, or no card box at all, is a problem. Printed per picture as `card ... percent of the height`.

## 4. Page contract (shot mode)

Shot mode is what makes a picture repeatable. Without the `shot` URL parameter the game behaves exactly as it does today and none of the shot code runs. Shot mode must not change rules, networking or cell numbering.

URL: `<entry>?shot=<scene>&quality=<low|medium|high>` plus optional keys. The entry page and the server command are set in `tools/shots.config.json` (`serve` with `{port}` and `{python}`, `cwd`, `entry`).

1. Scenes. The set `flow` gives each item its own scene; the other sets use `--scene`. `field` is a fixed mid game position of about 14 stones, written as ONE constant in one small module and legal under the game rules, that shows everything the game draws today (plants at several growth stages, a rock if the game has them, one selected skill, the last move marker, both HUD cards). `empty` is an empty board with the same HUD. `menu`, `howto` and `settings` (docs/flow-design.md section 7) show the main menu, the How to Play panel and the Settings panel over the empty farm, with no HUD; their state comes from the flow reducer (`shotFlow` in `src/ui/shot-mode.js`). The first menu button (or the open panel's Close button) has the focus, so its focus ring shows. `lobby`, `waiting` and `starting` show the lobby and the waiting room (phases waiting and starting) over the empty farm, with no HUD and no backdrop blur, drawn by `src/ui/screens.js` from a still view (`shotRoomView` in `src/ui/shot-mode.js`, no network): room code `ABCD5`, this window the host, whose seat picked Wind Rabbit (the guest seat has no pick yet). The first enabled button has the focus. `gameover` and `gameover-pending` show the field scene (with no skill selected) and its HUD as the online viewer playing Wind Rabbit, who won, with the game over card of `src/ui/screens.js` on top, drawn from a still view (`shotGameOverView` in `src/ui/shot-mode.js`): headline You win, subline Wind Rabbit won; the Rematch button is idle in `gameover` and in the state mine (Waiting for opponent, disabled, hint Your request was sent) in `gameover-pending`. The first enabled button has the focus.
2. Quality. The `quality` parameter sets the level for this page, over any stored choice.
3. Frozen. Every time driven thing (clouds, wind sway, idle animation, sprite frames, water, grain, shader time) uses one fixed time of 12.0 seconds. Every random source uses a fixed seed. No mouse hover, no tutorial or tip popup, no sound, no FPS counter or debug overlay, and no attempt to open a network connection (no websocket, no matchmaking).
4. Window. The page sizes itself from the window (innerWidth and innerHeight). Playwright sets the viewport and asks for reduced motion, so the HUD transitions must be instant.
5. State object. At start, before the first frame, the page sets `window.__SHOT__ = { scene, quality, renderer, ready: false, info: {} }`. `renderer` is `"3d"` or `"2d"`. `ready` becomes true when all assets are loaded and at least 3 frames were drawn at the final window size. `info` may hold any plain numbers.
6. HUD boxes. Every HUD element that takes screen space and must not overlap another one has the attribute `data-hud-box="<name>"`: the cards, the collapsed pills, the turn pill, the quality switch, every top bar button, and a tooltip while it is shown. Nested boxes are fine. The menu layer names `menu-card`, `menu-play-online`, `menu-play-local`, `menu-howto`, `menu-settings`, `howto-panel`, `howto-close`, `settings-panel`, `settings-close`, `settings-quality-<level>` and `settings-fullscreen`; while a panel is open the menu card is hidden (visibility hidden), so it neither overlaps the panel nor takes the focus. The lobby and room screens name `lobby-panel`, `lobby-create`, `lobby-join`, `lobby-back`, `join-panel`, `join-code`, `join-submit`, `join-back`, `waiting-panel`, `waiting-code`, `waiting-copy`, `waiting-leave`, `card-host` and `card-guest` (the seats are named by whose seat they are, not by their side), and in this window's seat `pick-<seat>-<character>` (for example `pick-host-wind-rabbit`) and `ready-<seat>`. The local character select names `select-panel`, `select-back`, `card-player1`, `card-player2` and the same pick and ready buttons. The game over card names `gameover-card`, `gameover-rematch` and `gameover-menu`; it must overlap no HUD box (its top edge sits below the turn pill and the quality switch).
7. `hud=expanded` or `hud=collapsed` (added by the collapsible HUD part): sets the card state of both teams and ignores the stored choice.

## 5. Self-check protocol (AGENTS.md rule 6)

1. Run the set the task names. Read `shots/report.json`. Fix every problem it lists, then run again.
2. Open at most 3 of the PNG files with the image reading tool (Read on the path). Compare each with the reference picture the task names. Look for what the task is about, not for everything.
3. Write a short paragraph that starts with `Seen:` in the final summary: what the pictures show in plain words, with the key numbers from the report. Write only what you saw.
4. If something is wrong, fix it and take the pictures again. At most 3 rounds, then stop and say what is still wrong.
5. The reviewer may not be able to see pictures, so the numbers in the summary matter.

## 6. End to end check (e2e)

`bash tools/shots.sh e2e` runs `tools/flow_e2e.py` with the same Python and Chromium as the pictures. It serves the game, opens two pages in one browser context (so BroadcastChannel reaches between them) at quality Low and 1280x720, and walks the real flow: the menu, a local game and a reload, Create Room, a join typed in lower case with a space, the start, a leave with its countdown and game over card, a wrong code and the typing guard. It reads the page through `data-screen` on the body (menu, lobby, waiting, starting, game, gameover) and `data-room-code` on the waiting room code, and waits for those values, never for a fixed time. Limits come from src/config.js. `shots/e2e.json` lists every step with name, ok, ms and a detail, plus the console errors of both pages (they must be 0). It saves `shots/e2e-host.png` and `shots/e2e-guest.png` when both pages entered the game. Exit codes: 0 every step ok, 1 a step failed, 2 the browser or the server could not start.

## 7. Limits

The pictures show layout, colour, shapes, density and overlaps. They do not show frame rate, and bloom and depth of field can differ a little from the real GPU. Never state an FPS number. The owner measures FPS on the real machine with `?fps=1`.
