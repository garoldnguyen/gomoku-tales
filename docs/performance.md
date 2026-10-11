# Battery and heat (frame pacing)

Owner request, October 2026: the game drains a phone's battery fast and the phone gets hot, and the graphics
should stay good. The cause was simple: the page drew the whole scene on every screen refresh (60, and 90 or
120 on newer phones) whether or not anything moved, and kept the browser's frame pipeline running all the
time; on Medium and High the frosted HUD cards were re-blurred on each of those frames too.

## What was measured

Headless Chromium with software GL, so the numbers show the work the game asks for (draw calls, triangles,
pixels, wake-ups), not a frame rate. Phone shape 390 x 844 at pixel ratio 3, local game, one picture:

| | before | after |
|---|---|---|
| Medium, idle: scene draws a second | 60 (every refresh) | 8 |
| Medium, playing: scene draws a second | 60 | 30 |
| Medium, idle: draw calls a second | about 5,500 | about 720 |
| Medium, drawing buffer | 585 x 1266 (0.74 MP) | 487 x 1055 (0.51 MP) |
| Medium, idle: animation frame callbacks a second | 60 | about 16 (the loop sleeps on a timer) |

Idle means nothing was touched for FRAME_ACTIVE_MS (4 s). The same two changes cut the idle work of Low by
the same share. High keeps its wind and clouds moving, so it only gains the 30 fps pace and the lower
pixel ratio on a phone.

## What was changed

1. Frame pacing (`src/render3d/frame-governor.js`, pure; the rates are `FRAME_*` in `src/config.js`).
   - Active (the player touched something, an event or a change happened, a plot is under the pointer): at
     most 30 frames a second on a touch device, 60 on a computer, whatever the screen's refresh rate.
   - Idle (nothing for 4 s): 8 frames a second on a touch device, 15 on a computer, 3 behind a blurred menu.
   - A level with background motion (High) is always active. A touch, a key, a resize or the page coming
     back wakes the loop at once; a seed, a skill, an event from the opponent or a new screen too.
   - Between frames the loop sleeps on a timer instead of asking for an animation frame at every refresh, so
     the browser's frame pipeline (and the compositor, and the HUD blur) is off in between.
   - The slow-frame watch of the quality levels is told the pace (`FRAME_SLOW_FACTOR`) and skips idle
     frames, so a 30 fps loop or an idle page never steps the level down; slow frames still do.
2. Touch devices (`(pointer: coarse)`): a lower pixel ratio cap per level (`touchPixelRatioCap` in the
   quality table: 1, 1.25, 1.5), no multisampling (the pixel art has hard edges) and the low-power GPU hint.
   Medium on a phone draws a third fewer pixels. A picture of the board with and without it looks the same
   at the size of a phone.

What did not change: the quality table's other rows, the art, the rules, the shot mode (its own loop), and
how a computer looks: the pace on a computer is 60 while playing.

## Tests and checks

`tests/frame-pacing.test.js` (the rates on 60, 90, 120 and 144 Hz screens, idle and wake, sleeping with
`dueIn`, the state signature, the slow-frame watch with a pace, the world not stepping down at 30 fps or
idle, the touch pixel ratios, the wiring in `main.js`). `bash tools/shots.sh e2e` still passes. The frame
path test lists the new functions (`FRAME_PATH`): none allocates.

## Left for later

- High: 16 render passes a frame (depth of field, bloom, grade) are the heaviest thing left; a half
  resolution blur would cut them. Phones are better served by Medium.
- The Battery Status API (Android only) could drop the pace further under 20 percent.
- FPS on a real phone cannot be measured here: the owner measures with `?fps=1`.
