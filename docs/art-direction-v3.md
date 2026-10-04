# Gomoku Tales: Art Direction v3, "Farmland"

Status: approved by the game's owner after the Farmland Look Lab. This file replaces every wood board, wood panel and old sky/wind rule from `docs/art-direction-hd2d.md`. Rules, networking and the 3D camera stay as they are. Read this before touching `src/render3d` or `src/ui`.

All pictures named here are in `docs/reference/v3/`. The real sprites are in `assets/3d/v3/`. Tuning numbers (anchors, stage times, looks) are in `assets/v3-meta.json`. The glass HUD CSS is `docs/reference/v3/hud.css`.

## 1. Goals and pillars

The owner's five points, in order:

1. The wood board is gone. The 15 by 15 board is a farm field of tilled plots. Playing a move is planting a seed, and the X or O is the plant that grows out of it.
2. The name and skill panels are minimal, modern glass cards. No wood, no thick borders, no ornaments.
3. Low, Medium and High are clearly different. Low is clear and easy to play. Medium adds shade and things to look at. High adds depth, clouds and wind. Section 5 is the exact table.
4. The sky stays, but clouds and wind are redrawn to belong to the farm: soft painted clouds, drifting petals and seed fluff, no straight streak lines.
5. The meadow around the field is full of varied flowers: 13 kinds, 31 looks, planted in drifts.

Pillars that every task must respect:

- Readability first. A player must be able to read the 15 by 15 grid, every plant and the hover and last-move marks at a glance, on every quality level, even with a cloud shadow or a drifting petal over a plot.
- The shape rule. Colour never carries the team alone. X is always a blue four-petal cross bloom. O is always a red round ring-of-petals bloom. They must still read apart in grayscale and at the smallest zoom.
- One wind. Clouds, petals, seed fluff, grass sway and cloud shadows all move in the same direction: from the upper left toward the lower right of the screen. The sun is in the upper left, so shadows fall toward the lower right. Clouds are high above the ground, so their apparent motion is horizontal: they drift straight to the right across the screen.
- One pixel grid. Everything is pixel art on the same grid as the board: one cell is 32 art pixels, `PX_WORLD = 1/32`. No sprite may be scaled by a non-integer factor at rest. Textures use NearestFilter.
- Same at every level: camera angle, the 15 by 15 plots, seed to bloom growth, blue X and red O, gold hover brackets, the last-move ring, and the glass panels (only their frost changes).
- Each quality level only adds things to the one below it. Switching at any time never changes where anything is.

## 2. The pack

Palette: outline plum `#2b1d3a`. Wind Rabbit and X blue `#3b8cff` (dark `#2f63b0`, light `#9ccaff`). Earth Bear and O red `#ff4b5c` (dark `#a8304a`, light `#ffa8b4`). Gold `#ffe14d`. Grass `#58aa45`, light `#66b94b`, dark `#4a9a40`. Leaf `#6cc04a` `#4fa044` `#2f7a3c`. Soil `#8a5a3c` `#6b4430` `#5d3a2a` `#3a2419` `#2c1a12`. Every drawn sprite keeps the plum outline, except clouds which have none.

Files in `assets/3d/v3/` (sizes are frame size, frames in one row, anchor is the pixel that sits on the spot named in the last column):

| key in manifest | file | frame | frames | anchor | use |
|---|---|---|---|---|---|
| farm-board | farm-board.png | 480x480 | 1 | none | Medium and High board texture, 15x15 cells of 32 px, plot 30 px, gutter 2 px, 6 soil variants hashed per cell |
| farm-board-low | farm-board-low.png | 480x480 | 1 | none | Low board texture: same plots, bolder furrows, darker gutters, no crumbs |
| plant-x | plant-x.png | 36x40 | 5 | (18, 36) = plot centre | blue X growth, stages drop, land, sprout, open, rest |
| plant-o | plant-o.png | 36x40 | 5 | (18, 36) = plot centre | red O growth, same stages |
| rock-v3 | rock.png | 32x32 | 1 | bottom centre | Terrain Creation rock, mossy boulder |
| rock-small | rock-small.png | 16x12 | 1 | bottom centre | scenery pebble and stepping stone |
| trees | trees.png | 34x48 | 3 | trunk base | round, wide, tall tree |
| bushes | bushes.png | 22x15 | 3 | bottom centre | plain, flowering, small |
| hay-bale | hay-bale.png | 24x16 | 1 | bottom centre | scenery |
| grass-tufts | grass-tufts.png | 12x9 | 3 | bottom centre | scattered on the meadow |
| fence-post | fence-post.png | 6x26 | 1 | bottom centre | upright sprite |
| fence-rail | fence-rail.png | 16x6 | 1 | repeat in x | map on a thin box between posts |
| curb-wood | curb-wood.png | 32x8 | 1 | repeat in x | the wooden edge around the field, top surface |
| path-tile | path-tile.png | 40x32 | 1 | repeat in y | dirt path from the front of the field |
| flower-daisy, tulip, bluebell, poppy, sunflower, lavender, cosmos, forgetmenot, marigold, hollyhock, mushroom, dandelion, clover | flower-NAME.png | see v3-meta.json | 1 to 3 looks | bottom centre | meadow flowers, one frame per look |
| clouds | clouds.png | 148x56 | 6 | bottom centre | six painted cloud shapes |
| wind-bits | wind-bits.png | 7x5 | 6 | centre | petal pink, petal white, petal yellow, petal lilac, leaf, seed fleck |
| decal-hover-v3 | decal-hover.png | 32x32 | 1 | plot centre | gold corner brackets on the plot under the pointer |
| decal-select-v3 | decal-select.png | 32x32 | 1 | plot centre | white brackets for a chosen source plant |
| decal-last-x, decal-last-o | decal-last-x.png, decal-last-o.png | 32x32 | 1 | plot centre | ring under the newest plant, blue for X and red for O |
| decal-win-v3 | decal-win.png | 32x32 | 1 | plot centre | gold sparkle under each of the five winning plants |
| decal-dash-target-v3 | decal-dash-target.png | 32x32 | 1 | plot centre | red corner brackets on a Wind Dash target |
| decal-zone-v3 | decal-zone.png | 96x96 | 1 | zone centre | blue dashed frame with corner brackets on the 3x3 Tornado Zone |
| portrait-wind-rabbit-v3, portrait-earth-bear-v3 | portrait-*.png | 32x32 | 1 | none | HUD portraits, shown at 2x |

Fonts: `assets/fonts/dm-sans-latin-{400,500,600,700}-normal.woff2`, licence in `DM-Sans-OFL.txt`. The only UI font.

Reference pictures in `docs/reference/v3/`: `assets-overview.png` (every sprite, labelled), `scene-low.jpg`, `scene-medium.jpg`, `scene-high.jpg` (the target look for each level, 1920x1080), `hud-gameplay.png`, `hud-states.png`, `hud-quality.png`, `hud-phone.png`, `hud-states.html` plus `hud.css` (the HUD markup and CSS to copy).

Old assets to retire in the last task: `3d/board-top.png`, `3d/piece-x.png`, `3d/piece-o.png`, `3d/piece-rock.png` and the old flower, grass, cloud and decal entries that never had files. Keep the 2D fallback renderer (`?render=2d`) working with its own assets.

Wind Rabbit and Earth Bear are switched off in the world for now (`SHOW_WORLD_CHARACTERS = false` in `src/config.js`) because the HUD player cards carry the characters; their art, manifest entries and code stay, and setting the constant to `true` brings them back.

## 3. The farmland board

Geometry. The board is a flat plane of 15 by 15 world units (one cell = one unit = 32 art pixels) using `farm-board` (Medium, High) or `farm-board-low` (Low) with NearestFilter and no mipmaps. Cell (0, 0) is the same cell as today; do not change how cells are numbered or picked. Raycast picking must still return the same cell indices.

Plots. Each cell shows one 30 px soil plot with a 1 px grass gutter on every side, so neighbouring plots are 2 px apart. The plot is crumbly turned earth with dashed furrows, lit crests, clods and, on Medium and High, the odd pebble.

Edge. A wooden curb 8 art pixels wide runs around the whole field using `curb-wood` on its top surface, with a slightly darker front face about 6 art pixels tall on the camera side. Corners are mitred. The curb is a raised frame `CURB_HEIGHT` (6 art pixels, 6/32 world units) tall standing on the flat meadow, so its top face and its camera-side face both show, while the soil plots and everything on them stay at y = 0.

Fence (Medium and High). Posts every 3 cells along the back, left and right sides, about 1.5 cells outside the curb, two rails at 10 and 18 art pixels high. The front side is open, with the path.

Path (Medium and High). From the middle of the front edge toward the camera, 1.25 cells wide, `path-tile` repeated in y with two `rock-small` stepping stones.

Marks on plots (all levels, flat decals lying on the plot, slightly above it to avoid z-fighting):

- Hover: `decal-hover-v3` on the empty plot under the pointer. Gold, always visible, never dimmed by shadows or fog.
- Chosen source (Wind Dash, Stone Conversion): `decal-select-v3`.
- Wind Dash target: `decal-dash-target-v3`.
- Tornado Zone: `decal-zone-v3` centred on the 3x3 zone.
- Last move: `decal-last-x` or `decal-last-o` on the newest plant, blue or red by team, fades in with the Open stage and stays until the next move.
- Winner: `decal-win-v3` under each of the five plants, pulsing between 70 and 100 percent opacity once a second.

Ground around the field is the meadow, see section 6. Nothing but the board, curb and marks may touch the plots.

## 4. Seeds and plants

A move is a seed. The X or O is the plant that grows from it, then stays on the plot until it is removed by a game event.

Stages come from `plant-x` and `plant-o`, frame index equals stage. Times are the defaults in `v3-meta.json`:

| stage | frame | from | what happens |
|---|---|---|---|
| Drop | 0 | 0 ms | the seed falls onto the plot: slide the frame down by 10 art pixels over 150 ms, ease in |
| Land | 1 | 150 ms | the seed lands, soil heaves into a small mound. On High add a soil puff (6 to 8 soil-coloured pixels flying outward and falling, 300 ms) |
| Sprout | 2 | 450 ms | a bud pushes up between two leaves |
| Open | 3 | 850 ms | the bloom opens. Scale 1.0, 1.12, 1.0 over 120 ms. Medium and High add 4 sparkles (gold for X, pink for O) |
| Rest | 4 | 1200 ms | settled. On High it sways at rest, see section 6 |

The whole sequence is 1.2 seconds. The player's next move may be made as soon as the game logic allows; the animation never blocks input or logic and never changes rules. If a plant is created by a skill or already exists when a game is loaded, show stage Rest directly unless an event says it is new.

Reverse growth. Skill visuals may play stages backwards (a plant folding back into a seed) at 2.5 times speed.

Rocks (Terrain Creation) use `rock-v3` (the manifest key `rock` is the old 2D sprite and stays untouched): a mossy boulder, bottom centre on the plot. A rock lasts 4 turns by the rules; the renderer only follows the game events.

Placement. Draw the plant as an upright camera-facing sprite exactly as the existing piece sprites are drawn (same code path, same blob or sun shadow, same NearestFilter), but anchor pixel (18, 36) of the frame on the plot centre. The sprite is 36 by 40 art pixels, so it stands a little taller than one cell and its bloom overhangs the plot behind it. Draw order must keep a plant in front of the plots behind it and behind the plots in front of it, so rows read correctly. The flat plot is part of the board texture, not the sprite.

Shape rule reminder: X is the four-petal blue cross, O is the red round ring. Do not recolour or reshape them for any effect.

## 5. Quality levels: the exact table

Create ONE table, `src/render3d/quality.js`, with these keys for `low`, `medium` and `high`. Every module reads from it. Nothing else in the code may test the level name.

| feature | low | medium | high |
|---|---|---|---|
| goal | clear and easy to play | shades and a lived-in farm | shades, depth, clouds and wind |
| renderer pixel ratio cap | 1 | 1.5 | 2 |
| board texture | farm-board-low | farm-board | farm-board |
| ground | flat mown meadow: two greens in 3-cell stripes, nothing else | painted mottled meadow, grass tufts | same as medium plus slow lighter wind ripples |
| scenery (trees, bushes, hay, fence, path, stepping stones) | off, curb only | on | on |
| meadow flowers | off | on, still | on, swaying, dandelion puffs lift off |
| far hills | off | on | on, with haze |
| sky | plain gradient only | gradient plus 4 still painted clouds | gradient plus 8 drifting clouds in 2 layers, wisps, sun rays |
| shadows | none | soft blob shadow under every plant, rock, post, tree, bush, bale | long sun shadows (sheared sprite silhouettes, lower right) plus slow cloud shadows on plots and meadow |
| post effects | none | none (no blur at all) | bloom on bright petals, depth of field, warm grade, light vignette |
| wind | none | none | petals, leaves and seed fluff in 3 lanes with ghost trails; grass, flowers and resting plants sway |
| growth animation | yes, no extras | yes, plus Open sparkles | yes, plus soil puff, sparkles, light screen shake on rock landing |
| skill effects | simple: marks and a short slide, no particles | marks, slides, a few particles | full effects |
| HUD frost | solid cards, no blur, no shadow | blur 10 px, small shadow | blur 18 px, soft shadow |
| moving things in the background | none | none | clouds, wind, sway, rays |
| target frame rate | 60 on a weak phone | 60 on a laptop | 60 on an integrated GPU such as a Radeon 780M, never below 30 |

Particle budgets (hard caps): low 0, medium 60, high 220 live particles at once, all pooled, no per-frame allocation.

Persistence: the choice is saved in `localStorage` (guarded with try/catch, the game must work without it) and applied at startup. The `Q` key and the HUD switch call the same `setQuality(level)`. Switching rebuilds only what changed and never resets the game.

Unknown level values fall back to `medium`.

URL switches for finding a culprit on High (parsed by `parseFxSwitches` in `src/render3d/quality.js`, applied by `fxFeatures` on High only; Low and Medium ignore them, and unknown names or values are ignored). `?fx=off` turns off every High-only screen effect: bloom, depth of field, warm grade and vignette, wind and sway, sun rays, long shadows (blob shadows instead) and ripples. `?dof=off`, `?bloom=off`, `?wind=off`, `?rays=off`, `?shadows=off` and `?ripples=off` turn off one each. Each also takes `on`, so `?fx=off&dof=on` keeps only the depth of field. Example: `http://localhost:8000/?quality=high&dof=off`.

The depth of field never softens the field: its blur radius is exactly 0 from 3 world units in front of the field's front edge to 3 world units behind its back edge (which covers the fence and the back row of trees) and grows only gently outside that band (`blurRadius` in `src/render3d/depth-of-field.js`). It reads the scene's own depth, where sprites write depth only where their alpha test keeps a pixel and soft quads (wisps, rays, petals, ghost trails, decals) write none.

## 6. Meadow, flowers and scenery

The ground is perfectly flat (height 0 everywhere, one rectangle that reaches past the left, right and bottom of the screen): there is no dome and no rim, and the horizon is the meadow's far edge, placed by `farEdgeZ` in `src/render3d/horizon.js` 21 percent down the screen, with the far hills, the back row of trees and the sky behind it.

13 kinds, 31 looks (one frame per look in `flower-NAME.png`): daisy 3, tulip 3, bluebell 3, poppy 3, sunflower 1, lavender 2, cosmos 3, forget-me-not 2, marigold 2, hollyhock 3, mushroom 3, dandelion 2 (bloom, seed puff), clover 1.

Planting rules:

1. Patches of one kind. A patch is a drift of 5 to 14 plants of ONE species, so colour reads as drifts of poppies or a bank of lavender, never confetti.
2. Looks mix inside a patch. A daisy patch uses all three daisy looks. Grass tufts and clover fill its edge.
3. Never on or inside the field. Keep-out: the field plus the curb, the fence line, the path, and a 1-cell margin around all of them. Wild flowers are never on a plot, so everything standing on a plot is a move.
4. Placement is deterministic. Use a seeded generator (seed `20261002`) and a pure function `planMeadow(seed, bounds, keepOut)` that returns the same list every time, so the meadow looks the same every game and can be unit tested. Poisson-disc spacing, minimum 0.7 cell between plants. About 36 patches. Species weights: daisy 3, tulip 3, bluebell 3, poppy 3, cosmos 2, marigold 2, lavender 2, forget-me-not 2, dandelion 2, hollyhock 1.5, mushroom 1.5, sunflower 1.
5. Tall flowers (hollyhock, sunflower, lavender) go toward the back and sides, low ones (clover, forget-me-not, mushroom) toward the front, so nothing hides the field from the camera. Keep the screen areas under the two HUD cards calm: no tall flowers behind them.
6. Draw with instancing (one draw call per species at most). Billboards, upright, root fixed.

Sway (High only): a vertex shader lean. Offset in x grows with the square of height fraction `h` (0 at the root, 1 at the top), maximum 1 art pixel in calm wind and 2 in a gust. Per-plant phase from its position. Roots never move. Wind direction is `(1, 0, 0.35)` normalised on the ground. Gusts: every 7 to 11 seconds, 1.2 seconds long, tripling the speed of petals and doubling sway. Resting X and O plants sway at half that amplitude. The dandelion seed puff releases a `seed` bit every 6 to 10 seconds per puff, which drifts away on the wind.

Scenery (Medium and High):

- Trees: 12 to 14 along the far edge of the meadow where it meets the hills, irregular spacing, always scale 1 (never fractional: vary them with random mirroring and a plus or minus 6 percent brightness shift), plus 4 to 6 along the left and right edges. Mix the three trees.
- Bushes: 8 to 10, near trees and the fence. The flowering one more near the flower patches.
- Hay bales: 3, near the fence, one on its own beside a patch.
- Grass tufts: 120 to 160 scattered on the meadow outside the keep-out area.
- Far hills: two silhouettes made from sums of sines, far `#8fcf8a`, near `#6fba6a`, with haze toward the sky colour. High adds a little haze gradient.

## 7. Sky, clouds and wind

The ground is flat with no dome or rim, so the horizon is the meadow's far edge that `farEdgeZ` places 21 percent down the screen: the sky gradient runs from the top of the screen down to it, the two hill silhouettes cover its lower part (crests 15 to 19 percent down) on Medium and High, and every cloud stays whole in the strip above the crests.

Sky gradient from top to horizon: `#4a90e2`, `#7fbdf0` at 45 percent, `#cfe8f8` at 80 percent, `#f4f0d8` at the horizon. It is a plain gradient, no dithering.

Clouds use `clouds.png`: six painted shapes with flat bottoms, a warm cream rim on the sun side and a blue-grey underside. No outlines, because real clouds have none. Never draw the old sprite clouds or any straight line effect.

- Medium: 4 clouds placed still at fixed spots (about 14, 50, 78 and 90 percent across, 8 to 16 percent down). They never move.
- High: 8 clouds in two layers. Far layer: 4 clouds at scale 0.6, speed 0.35 world units per second. Near layer: 4 clouds at scale 1.0, speed 0.6. Clouds are high above the ground, so their apparent motion is horizontal: clouds and wisps drift straight to the right along the screen x axis at their layer speed, stay at their height inside the sky strip, and wrap around sideways only when fully off screen, coming back in fully off the left edge (petals, seeds and ground effects keep the full diagonal wind). Add 6 wisps: thin soft horizontal streaks, alpha 0.25, made from a procedural gradient quad, drifting with the far layer. Add 3 soft sun rays from the upper left: additive wedges at alpha 0.10 that breathe with a 14 second period.
- Cloud shadows (High): large soft blurred patches on the ground, multiply blend, never darker than about 25 percent, sliding at the near-layer speed. A plot must always stay readable under one.

Wind petals (High): the wind carries `wind-bits`: pink, white, yellow and lilac petals, a green leaf and a seed fleck. Three lanes at different distances: far (scale 0.6, 0.6 units per second, slightly blurred), mid (scale 1.0, 1.0), near (scale 1.6, 1.5). About 40 in view in total. Each petal has a soft trail made of 3 ghost copies at 60, 120 and 180 ms behind with alpha 0.5, 0.3, 0.15. There are NO streak lines anywhere. Petals pass above the field but never hide a plot for more than a moment: near-lane petals fade out while over the field.

Old sky and wind code (straight wind streak lines, the old sprite clouds) is deleted in the final task.

### Framing numbers

Measured on `docs/reference/v3/scene-*.jpg` (1920 x 1080) and kept in ONE place, `CAMERA_POSE` and `FRAMING` in `src/render3d/framing.js`, which both the renderer and the HUD layout (`src/ui/hud-layout.js`) read; the tests check them by projecting points through the real camera at 16:9 (percentages of the screen height from the top, widths as percentages of the screen width):

- Camera: pitch 45 degrees, vertical field of view 17 degrees, distance 65.5 world units from the aim point, which lies 2.2 world units behind the board centre on its centre line (no sideways offset), so the board centre shows at about 58 percent and the far edge lands at z of about -11.
- Far edge (horizon): 21 percent (accepted 19 to 23; the same at 4:3, 16:10 and 21:9; 10 to 30 at 9:16 portrait), placed by `farEdgeZ` through NDC y = 0.58.
- Far hill crests: 15 to 19 percent, their feet hidden below the far edge.
- Back-row tree trunk bases: 22 to 25 percent, crown tops 11 to 17 percent at scale 1 (never rescaled), the row wider than 21:9 plus 2 world units each side (12 to 14 trees on screen at 16:9, at most 18 in all); side trees only in the back third of the visible ground.
- Field, outer curb corners: back edge 31 percent (28 to 34), front edge 90 percent (87 to 93), back width 42 percent (39 to 45), front width 50 percent (47 to 53), horizontal centre 50 percent (48.5 to 51.5).
- Low: the far edge is a gentle wavy line at most 1 percent of the screen tall.

## 8. HUD: quiet glass

Replace the 2D canvas HUD with a DOM overlay (HTML and CSS) stacked over the WebGL canvas, because frosted glass needs `backdrop-filter`. Copy `docs/reference/v3/hud.css` to `src/ui/hud.css` and build the DOM like `docs/reference/v3/hud-states.html`. Fix the `url()` paths for the fonts to where `assets/fonts` really is.

Layout (1920 wide): top bar centred at 28 px from the top with the turn pill; quality switch top right, 40 px from the right edge; two cards 250 px wide and at most 310 px tall (Design v4; `HUD_CARD_WIDTH_PX` and `HUD_CARD_HEIGHT_PX` in `src/config.js`, was 332 px wide), 56 px from the sides, 120 px from the top. Below 700 px wide the cards become slim bars at the bottom (avatar, name, status, two 48 px skill buttons) and the top bar shows the turn pill and the compact quality switch. `docs/reference/v3/hud-phone.png` shows it.

Tokens: card `rgba(14,20,34,0.64)` with an 18 px blur, 1 px border `rgba(255,255,255,0.18)`, corners 28 px, rows 18 px, status chips are pills. Wind blue `#3b8cff`, bear red `#ff4b5c`, win gold `#ffe14d`, ready green `#8fe3a8`. One font, DM Sans. Text sizes: name 22, skill title 17, state 13, label 12. Touch targets at least 44 px.

Card content: portrait tile (2x portrait, tinted by team), name, `Plays X, 7 planted`, a status chip, a divider, the label `SKILLS`, and two skill rows (Design v4: rows 60 px tall, `HUD_SKILL_ROW_PX`, the icon filling the square at the row's start with object-fit cover and no gap; then title and state). Text sizes on the smaller v4 card: name 18, skill title 15, state 12, label 11.

States (use these exact English strings):

| situation | chip | skill state text |
|---|---|---|
| my turn, skill ready | Your turn | Ready |
| a skill is chosen | Your turn | Selected (row gets a team-coloured ring) |
| skill cooling down | Your turn or Waiting | Ready in N turns, with a cooldown ring around the icon filling as turns pass and the number N over the icon; use "turn" for 1 |
| opponent's turn | Waiting | Wait for your turn (rows dimmed) |
| round won | Winner on the winner's card (gold) | Round over on both cards |
| opponent left | the pill shows "Opponent left" with the 10 second countdown, then the win | |

The turn pill shows the player's colour dot, `Wind Rabbit's turn` or `Earth Bear's turn` and the hint from the existing status line (`Plant a seed`, and the targeting prompts the game already shows). Keep every existing status and winner message the game already produces, in English, shown in the pill or as a toast in the same glass style.

Quality: Low is solid and flat (no blur, no shadow), Medium blurs 10 px, High blurs 18 px with the soft shadow. See `hud-quality.png`.

Build a pure function `hudViewModel(gameState, uiState, localPlayer)` that returns everything the DOM needs (strings, states, cooldown progress) and unit test it. The DOM code only renders the view model. Every control is a real `button`, has a visible focus ring, and icon-only buttons have an `aria-label`. All existing skill targeting flows (click a skill, then click plots) must keep working, including with the keyboard shortcuts the game has today.

## 9. Skill visuals on the farm

Visuals only follow logic events; they never change rules.

- Wind Dash: the source bloom folds back into a seed (stages in reverse), the seed rides a short gust of petals along a curve to the target, and regrows there from Land. The target shows the red brackets before it resolves.
- Tornado Zone: a translucent swirl of petals and leaves over the 3x3 zone, the plants inside bend toward the swirl, thrown plants fly off as seeds in an arc and land with a soil puff, then regrow from Land.
- Terrain Creation: a rock falls from above with a growing shadow, lands with a soil puff and, on High, a light screen shake. When it breaks it crumbles into soil crumbs and pebbles and the plot is plain soil again.
- Stone Conversion: the plant wilts back to the sprout stage, a small spark passes through the soil, and it regrows as the other team's plant from Land. The conversion must also show the shape change: X becomes O or O becomes X.

Quality: Low shows the marks and plain slides, Medium adds a few particles, High adds everything.

## 10. Performance and tests

- No per-frame allocations in the render loop. Pool particles. Instance meadow flowers and trees.
- The field and plants must keep 60 FPS on High on a Radeon 780M class GPU at 1920x1080. If a feature cannot, lower its cost on High and say so in the task notes.
- Missing or wrong-size assets only warn in the console and never crash the game.
- Pure helpers with unit tests: `growthStage(elapsedMs)`, the quality table, `planMeadow`, wind and sway math, cloud wrap-around, `hudViewModel`, the v3 manifest checks.
- All existing tests (317 at the time of writing) must still pass.

### Performance results

FPS is measured by the owner, not by the builder: part 9 was built with no browser and no GPU, so nothing in this section is a measurement yet, and no number may be written here that was not measured on the target machine. This is a pending owner-run acceptance item.

Steps for the owner, once per level (`low`, `medium`, `high`):

1. Serve the game: `python3 -m http.server 8000` in the project folder.
2. Open a browser window of 1920 x 1080 (full screen on a 1080p monitor, page zoom 100 percent) at `http://localhost:8000/?local=1&quality=low&fps=1` (then `quality=medium`, then `quality=high`). `?fps=1` shows the FPS counter on every level in the top left corner: the line `Quality low [Q]  FPS N` and under it `Lowest FPS N`, the lowest reading since the level was set (each reading is averaged over `FPS_SAMPLE_MS`).
3. Plant a few seeds, then leave the window alone in front, without moving the mouse, and wait 30 seconds.
4. Write down the lowest number (`Lowest FPS`) and the typical number (the `FPS` value it shows most of the time) in the table below, with the machine, GPU and browser.
5. If `(auto)` appears after the level name, the automatic step down left that level (it ran slower than `TARGET_FRAME_MS` for 3 seconds); write that in the notes and measure that level again after reloading the page.

| level | lowest FPS | typical FPS | machine, GPU and browser | notes |
|---|---|---|---|---|
| Low | not measured yet, owner to fill in | not measured yet, owner to fill in | | |
| Medium | not measured yet, owner to fill in | not measured yet, owner to fill in | | |
| High | not measured yet, owner to fill in | not measured yet, owner to fill in | | |

If High is below 60 FPS, cut costs in this order, measuring again after each step, and stop as soon as High holds 60:

1. The cloud shadow layer resolution: `CLOUD_SHADOW_MASK_PX` in `src/config.js` (for example from 128 to 64).
2. The long shadow count: `SUN_SHADOW_MEADOW_FLOWERS = false` in `src/config.js` keeps the long shadows of the board sprites, trees, bushes and bales and drops the 13 instanced flower kinds.
3. The bloom: `BLOOM_STRENGTH` and `BLOOM_RADIUS` in `src/config.js`, or bloom off in the High row of `src/render3d/quality.js`.
4. The depth of field: fewer samples (`DOF_TAPS` in `src/render3d/post-processing.js`). Never change its zero band (part 6d), so the whole field stays sharp.

To find the culprit quickly before cutting anything, use the URL switches from part 6d (section 5), one at a time on top of `?local=1&quality=high&fps=1`: `&shadows=off` (long and cloud shadows, blob shadows instead), `&bloom=off`, `&dof=off`, `&wind=off`, `&rays=off`, `&ripples=off`, or `&fx=off` for every High-only screen effect at once. A switch that brings the number up a lot points at its feature.

What part 9 changed for cost, without measurements:

- The sun's shadow map is gone (it rendered the scene a second time into a 2048 x 2048 map, and its shadows fell the wrong way). Long sun shadows are flat decals instead: one quad per board sprite, and one instanced draw call per meadow kind (3 scenery kinds plus 13 flower kinds), all built once.
- Cloud shadows are one flat quad with one texture read per pixel from a `CLOUD_SHADOW_MASK_PX` square soft mask, discarded where there is no shadow.
- The warm grade and the vignette share one full screen pass. The bloom threshold is above everything but the sparkles and the bright petals.
- The 3D frame path (everything `drawGameScreen` and `drawMenuScreen` run each frame) allocates nothing once its pools are warm; `tests/render3d-high-polish.test.js` checks it by reading the source of every function on it and by counting the Three.js objects made over 200 frames on each level.
- A quality switch makes, replaces and disposes nothing: every pass, texture, material and shadow mesh is built once and only turned on and off; the same test file checks it on the real scene.

#### Known allocations

The test lists every function of the 3D frame path by file and name (`FRAME_PATH` in `tests/render3d-high-polish.test.js`), and none of them allocates on an ordinary frame. Pools and caches that grow only on a miss (piece sprites, decals, zone pieces, the FPS text lines) and work done only on a frame with game events or a quality change are named there with their reason (`NOT_EACH_FRAME`). Three.js's own renderer and EffectComposer, and the DOM HUD view model (`hudViewModel` and `hud.render`, called only when something on the HUD changed), are out of scope.

These still allocate on every frame. They are the game view models the render loop reads, outside `src/render3d`, and were not removed in part 9 because rewriting them in place changes the shared view contract of the HUD, the screens and the 2D renderer:

- `src/ui/local-game.js` `getView` (with `panelView`, `targetPreview` and `statusText`): a new view object and a new panels list each frame (`?local=1`).
- `src/ui/online-game.js` `getView` and `getOutcome`: a new view object and panels each frame, and an outcome object (`gameOutcome`) each frame in an online game.
- `src/net/room.js` `getView`: a new room view object, called by the two above each frame in an online game.

## 11. Visual QA checklist (for the owner, after the last task)

1. Low, Medium and High look clearly different and each matches its `scene-*.jpg` in spirit.
2. Plant a seed: it drops, lands, sprouts and opens in about 1.2 seconds, X is a blue four-petal cross and O is a red round bloom.
3. Five in a row: the winning plants show the gold sparkle mark.
4. Clouds drift only on High. No straight streak lines anywhere.
5. Flowers appear in drifts of one kind, never on a plot.
6. The cards look like frosted glass on High, solid on Low.
7. Every skill still works, with cooldown rings.
8. No console errors.

## 12. Do not

- Do not bring back wood in the UI or the board. The curb and fence are the only wood.
- Do not draw straight wind streaks, outlined clouds or confetti flowers.
- Do not put anything on a plot except a plant, a rock or a mark.
- Do not change game rules, networking or cell numbering.
- Do not add fonts, libraries or network requests for art. Everything is vendored.
- Do not scale pixel sprites by non-integer factors at rest.
