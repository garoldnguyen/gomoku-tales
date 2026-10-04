# Flow QA: menu, waiting room and rematch

The owner's checks for the screen flow (docs/flow-design.md section 9). Serve the game with `python3 -m http.server 8000` and open http://localhost:8000.

## Owner checklist

Tick each line when it holds.

1. [ ] Reload the page. The menu is the first screen, the farm is behind it, there are four buttons.
2. [ ] Play on this computer: the game starts. Play until someone wins. Press Rematch: a clean board appears at once, no old plants, rocks or banners. Press Back to Menu.
3. [ ] How to Play: the skill numbers read 3, 6 and 4 turns, the four skill texts are there, nothing is cut off at the window size you use.
4. [ ] Settings: switch Low, Medium, High. The page does not reload. The Fullscreen button works.
5. [ ] Two windows of the same browser: window A creates a room as Wind Rabbit, window B joins with the code. A shows the opponent card, then both enter the game after about 1.5 seconds.
6. [ ] Type a code containing C, F, Z, H or V in the join box. Nothing else happens (no fullscreen, no HUD toggle).
7. [ ] Wrong code: a clear message appears under the box, no pop-up.
8. [ ] In an online game close window B. Window A shows the 10 second countdown, then the game over card. Rematch is disabled with Opponent left. Back to Menu works.
9. [ ] Win an online game. Press Rematch in window A only: it says it is waiting, window B says Opponent wants a rematch. Press Rematch in B: both get a clean board, Wind Rabbit first.
10. [ ] Leave in the waiting room: the menu appears. Join with the old code from the other window: not found.

## Automatic checks

Both commands need the shots tool setup of docs/shots.md section 1. Exit code 0 means all good, 1 problems found, 2 the tool could not run.

- `bash tools/shots.sh flow` (the same as `--set flow`): pictures of the menu, howto, settings, lobby, waiting, starting, gameover and gameover-pending scenes at 1920x1080 and 1280x720 (Medium). Read `shots/report.json`: per picture the box overlaps, the boxes outside the window, the smallest button side (at least 44 px) and the console errors must pass; the game over card is at most 24 percent of the window height.
- `bash tools/shots.sh e2e`: `tools/flow_e2e.py` walks checklist items 1, 2 (up to the game), 5, 6, 7 and 8 in two pages of one browser at Low and 1280x720, and writes `shots/e2e.json` (each step with name, ok and milliseconds, and the console errors of both pages, which must be 0). Pictures of both pages in the game: `shots/e2e-host.png` and `shots/e2e-guest.png`.

The automatic checks do not replace items 3, 4, 9 and 10, which need a person.

## Known flakes

None so far. Three e2e runs in a row passed every step when the check was added (2026-10-04).
