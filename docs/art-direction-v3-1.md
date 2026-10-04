# Gomoku Tales: art direction v3.1

Forest, horizon haze, full window view and collapsible HUD cards. Written after the owner's play test of v3. Read `docs/art-direction-v3.md` first: this document only changes what it lists. Where the two differ, this one wins. Game rules, networking and cell numbering do not change.

## 1. What the owner asked for, and what it becomes

| owner feedback | what we build | section |
|---|---|---|
| The view is not full screen, black empty bars on the left and right. | The canvas fills the whole window at any shape. The camera widens only when the window is narrower than 16:9. | 3 |
| Easy to play: a way to go fullscreen. | A Fullscreen button in the top bar and the key F (section 3.5). | 3 |
| Make the Card Character HUD collapsible. Collapsed, the skills must still be one click away. Let players read what a skill does. | Each card folds into a slim pill (portrait, two skill buttons, chevron). Every skill has a short description in the expanded card and in a tooltip. | 4 |
| The green trees at the back do not look cool. Make it look like a forest. | A real forest: far canopy wall, tree rows, undergrowth, new tree sprites. | 6 |
| The blend between the green hill, the horizon and the sky is not smooth. | One haze system: distance fades colour into the sky colour, ridges have soft crests, the grass edge fades. | 5 |

Decisions the owner already made (do not reopen them):

1. Forest: dense on High, a lighter version on Medium (two tree rows plus the far canopy wall), Low unchanged.
2. HUD cards start expanded, then remember the player's choice on this device.
3. The four skill descriptions in section 4 are accepted as written (the builder still checks every number against the code).
4. Low stays plain: only a soft sky-to-horizon gradient and the soft ground edge from section 5. No forest, no hills.
5. Window: the view always fills the window and adapts to its shape (Auto). A Fullscreen button is added. There is no setting to pick a fixed aspect ratio, so black bars never come back.

### Differences from `art-direction-v3.md`

| v3 text | v3.1 |
|---|---|
| Section 5, far hills: Medium on, High on with haze | Both levels get the two soft ridges of section 5 with haze. Low has none. |
| Section 6, 12 to 14 trees along the far edge | Replaced by the forest of section 6 on Medium and High. The 4 to 6 trees at the left and right edges stay unless they stand inside the forest zone. |
| Section 7, sky gradient `#4a90e2`, `#7fbdf0`, `#cfe8f8`, `#f4f0d8` | New stops in section 5. The horizon colour becomes the haze colour. |
| Section 7, Medium clouds 8 to 16 percent down | Clouds sit higher so the forest never hides them (section 6.8). |
| Section 8, two always-open cards | Collapsible cards with skill descriptions (section 4). |
| Section 5, Low is plain | Low stays plain. It gets only the new sky gradient and the soft ground edge (section 5.4). |

## 2. Reference pictures

All in `docs/reference/v3-1/`. They are made from the real sprites by a script, not by the game, so match them in spirit and in the numbers of this document, not pixel for pixel.

| file | shows |
|---|---|
| `scene-forest-high.jpg` | High: dense forest, ridges, haze, long shadows, 1920 by 1080 |
| `scene-forest-medium.jpg` | Medium: wall plus two tree rows, no blur |
| `scene-before.jpg` | Today, for comparison |
| `horizon-before-after.jpg` | The same strip of the horizon, today above and with haze and forest below |
| `window-wide-21x9.jpg` | A 21:9 window filled edge to edge |
| `hud-collapsed.jpg`, `hud-expanded.jpg`, `hud-states.jpg` | The cards collapsed, expanded, and the four collapsed states with tooltips |
| `hud-collapse-states.html`, `hud-expanded-reference.html`, `hud-collapsed-reference.html` | The same HUD as static HTML with the exact sizes, colours and shadows. Open in a browser. Copy numbers, not markup. |
| `forest-sprites.png` | The new sprites at 3 times size |

## 3. Full window view

### 3.1 Rules

1. The canvas is exactly the size of the browser window (width and height of the viewport, no margin, no scroll bars, no black stage, no fixed 16:9 box). The page background behind it is irrelevant because the canvas covers it.
2. On window resize and on orientation change the renderer size, the camera aspect, the pixel ratio (capped by `quality.js`: 1, 1.5, 2) and the HUD layout are updated in the same tick. Nothing is allocated per frame because of this.
3. The HUD floats over the picture exactly as today, positioned against the full window. A Fullscreen button and a key give a true full screen (section 3.5). There is no aspect ratio setting: the view is always Auto.
4. Mouse and touch picking use the canvas rectangle and the same camera, so a click lands on the cell under the pointer at every window shape.
5. Supported window shapes: 9:21 (tall phone) to 32:9 (super ultrawide). Outside that range nothing breaks, but it is not tuned.
6. The 2D fallback renderer (`?render=2d`) is not touched.

### 3.2 Camera: `fitView(aspect)`

The camera position and aim stay as they are today. Only the vertical field of view changes, and only for windows narrower than 16:9.

- `aspect` is width divided by height.
- At 16:9 and wider, `fitView` returns the current vertical field of view unchanged (17 degrees today; read the existing constant, never copy the number). A wider window therefore shows more meadow and forest at the sides and the board stays centred and the same size.
- Narrower than 16:9, `fitView` returns the smallest vertical field of view at which the four corners of the square `FIELD_HALF_EXTENT` on the ground (the 15 by 15 board, plus the 8 art pixel curb, plus a 1 cell margin: half extent 7.5 + 0.25 + 1 = 8.75 world units) are all inside the view, with a small tolerance. It never returns less than the 16:9 value.
- `zoomK(vfov)` is the tangent of half the reference field of view divided by the tangent of half `vfov`. It is 1 at 16:9 and wider and gets smaller as the view widens. Section 5 uses it to keep sky layers in proportion.

Expected values from the author's own model of the camera (aim 2.2 units behind the board centre, pitch 45 degrees, 17 degrees at 16:9). They are estimates for sanity checking, not targets: the real camera code decides, and tests must not assert these numbers.

| window | vertical FOV | far edge, percent from top | ground row at the bottom edge | visible half width at the far edge |
|---|---|---|---|---|
| 32:9 | 17 | 21.3 | z 10.0 | 38.6 |
| 21:9 | 17 | 21.3 | z 10.0 | 25.3 |
| 16:9 | 17 | 21.3 | z 10.0 | 19.3 |
| 4:3 | 17 | 21.3 | z 10.0 | 14.5 |
| 1:1 | 17 | 21.3 | z 10.0 | 10.9 |
| 3:4 | about 22.5 | about 28.5 | z 13.4 | 10.8 |
| 9:16 | about 29.7 | about 33.8 | z 17.5 | 10.8 |
| 9:21 | about 38.4 | about 37.7 | z 22.0 | 10.8 |

### 3.3 The world must cover the view

- Ground: the ground plane must cover every pixel below the far edge at every supported window shape. From the table: half width at least 44 world units (32:9 needs about 39), and the near edge far enough toward the camera for 9:21 (needs about z 22, so use at least z 24). Export the ground bounds as constants and derive them from one place.
- Meadow flowers: `planMeadow` stays as it is (so its tests and the central meadow stay identical). For the two side strips between x 27 and 44 on each side, add a second deterministic call with a derived seed (seed plus 1 for the left, plus 2 for the right) and the same density and species rules, on Medium and High only. Also respect the forest zone of section 6.7.
- The far canopy wall and the forest span x from -44 to 44 (section 6).

Not part of this: no change to the board size, the plot size, the pixel scale of plants or the look of the field.

### 3.5 Fullscreen button

- A real `button`, 44 by 44 px, in the top bar next to the quality switch, same glass tokens. Inline SVG icon (expand corners, and a collapse version while active), no new image assets. `aria-label` is `Enter full screen` or `Exit full screen`, and it has `aria-pressed`. In the slim layout below 700 px it stays in the compact top bar.
- It uses the browser Fullscreen API on the whole page (`document.documentElement.requestFullscreen()` and `document.exitFullscreen()`, with the `webkit` prefixed versions as a fallback if the page already supports them). The call is made directly from the click or key handler, because browsers only allow it from a user action; a failed promise is caught and ignored.
- Key `F` toggles it. First check the existing shortcuts in `src/ui/app.js` and the help text; if `F` is taken use `Z`. Ignore the key when a modifier key is held, when focus is in a text field, select or contenteditable element, and on key repeat. The browser's own Escape and F11 keep working. Write the final key in `docs/design.md`.
- The button label follows the real state through the `fullscreenchange` event, so it is right when the player leaves with Escape or F11. If the browser has no Fullscreen API (`document.fullscreenEnabled` is false, as on iPhone Safari), the button is not shown at all.
- Entering or leaving fullscreen needs no special scene code: the resize path of section 3.1 handles the new size.
- The view stays Auto. Do not add a fixed aspect ratio setting.
- Pure helper `fullscreenViewModel({ supported, active })` returns `{ visible, ariaLabel, pressed }`. Tests: unsupported hides the button, both labels and pressed states, the key helper (toggles, ignored with modifiers, in inputs and on repeat), and the `hud-layout` top bar rectangles with the button at 1920 by 1080, 1280 by 720, 800 by 600 and 390 by 844 with no overlaps and all inside the viewport.

### 3.4 Tests (all pure, no browser)

1. `fitView`: for 21:9, 16:9, 3:2, 4:3, 1:1, 3:4, 9:16 and 9:21, project the four corners of the `FIELD_HALF_EXTENT` square with the real camera at that aspect and check all are inside the view. For every aspect below 16:9 where `fitView` is above the 16:9 value (not clamped), check that a field of view 0.05 degrees smaller puts at least one corner outside (so it is the smallest). Where `fitView` is clamped to the 16:9 value by the floor of section 3.2 (this is the case at 3:2 and 4:3), assert that it equals the 16:9 value exactly and that all four corners fit at that value; the 0.05 degree check does not apply there, because the floor wins and the corners fit with room to spare. Decide clamped or not from the value `fitView` returns, not from a fixed list of aspects. Non-increasing in aspect. Exactly the reference value at 16:9 and above.
2. Ground coverage: for aspects 9:21, 9:16, 3:4, 1:1, 4:3, 16:9, 21:9 and 32:9, intersect the rays through the bottom-left, bottom-right and bottom-middle screen points with the ground plane and check each hit lies inside the ground rectangle with at least 1 unit to spare; and that at the far edge row the visible x range is inside the ground half width.
3. Picking: for aspects 21:9, 16:9, 4:3 and 9:16, project the centres of cells (0,0), (7,7) and (14,14) to pixel positions of a window of that shape, run them through the picking function and check the same cell comes back.
4. Resize: one pure function maps (window width, window height, quality) to the renderer size, pixel ratio and camera aspect; test that it uses the quality cap and never returns zero or negative sizes.

## 4. Collapsible HUD cards with skill descriptions

Reference: `hud-collapsed.jpg`, `hud-expanded.jpg`, `hud-states.jpg` and the three HTML files in `docs/reference/v3-1/`.

### 4.1 Behaviour

- Every card (Wind Rabbit, X, blue; Earth Bear, O, red) has its own chevron button, 44 by 44 px, a real `button`, with `aria-expanded` and `aria-controls` pointing at the part it hides, and the label `Collapse Wind Rabbit panel` or `Expand Wind Rabbit panel` (same for Earth Bear).
- Expanded: exactly the card of v3 section 8 (Design v4: 250 px wide and at most 310 px tall at 1920 by 1080) and the chevron in the card corner. Design v4 removed the description line under each skill row so the card fits that size; the description shows in the tooltip and in the skill detail popup that a click on a skill button opens (title, state, the full description and the hint; Escape or a press outside closes it, and the click still runs the skill).
- Collapsed: one pill, about 300 by 88 px (limits: width at most 320 and height at most 96 at 1920 by 1080), padding 8, gap 8, radius 32, same glass tokens as the card. Left to right: portrait tile 72 px (portrait 64 px, pixelated) with a 16 px turn dot at its top right, two skill buttons of 72 px (Design v4: the pixelated icon fills the whole button, object-fit cover, no gap), the chevron. It sits at the same anchor as the expanded card (56 px from its side, 120 px from the top).
- Start expanded. When the player collapses or expands a card, remember it in `localStorage` per team (`gomoku.hud.collapsed.x` and `gomoku.hud.collapsed.o`, value `1` or `0`), always inside try/catch; the game works without storage. Apply the saved state at startup. Unknown or missing values mean expanded.
- Key `C` toggles both cards. First check the existing keyboard shortcuts in `src/ui/app.js` and the help text; if `C` is taken, use `H`, then `V`. Ignore the key when a modifier key is held, when focus is in a text field, select or contenteditable element, and on key repeat. Write the final key in `docs/design.md`.
- Motion: about 180 ms ease-out (opacity and transform); instant under `prefers-reduced-motion: reduce`.
- Below 700 px window width the slim bars of v3 stay as they are: hide the chevron, ignore the saved state (do not erase it), keep the skill buttons.
- Hidden content must not be focusable or announced (use `hidden` or `inert`).

### 4.2 Collapsed states

| state | what shows |
|---|---|
| my turn, skill ready | Turn ring 2 px in the team colour (`rgba(59,140,255,0.55)` blue, `rgba(255,75,92,0.55)` red) around the pill, 16 px team-colour turn dot on the portrait, 16 px green dot `#8fe3a8` on each ready skill |
| skill selected | 3 px team-colour ring and a soft glow on that skill button, no green dot |
| skill cooling | icon at 40 percent opacity, an SVG ring (viewBox 72, radius 33, stroke 4, `stroke-dasharray` proportional to progress) around the button and the number of turns left over the icon |
| opponent's turn | whole pill at 55 percent opacity, skill buttons `aria-disabled="true"` (they do nothing, but still show their tooltip on hover or focus), no turn ring |

Clicking a collapsed skill button runs exactly the same code path as clicking the skill row of the expanded card, including the keyboard shortcuts the game has today. Selecting a skill while collapsed does not expand the card.

### 4.3 Skill descriptions (single source of truth)

One table `SKILL_INFO` (for example in `src/ui/skill-info.js`). The skill detail popup (Design v4), the tooltip and the `aria-label` read from it. Numbers inside the text come from the game's config constants, never from literals in the string.

| skill | description | hint |
|---|---|---|
| Wind Dash | Pick one of your plants, then a target plot. The plant folds back into a seed, rides a gust of petals to the target and grows again there. | Click to select, then choose a plot |
| Tornado Zone | Pick the centre of a {zone} by {zone} zone. A swirl of petals and leaves throws the plants inside off their plots. | Click to select, then choose the zone centre |
| Terrain Creation | Drops a rock on a plot. The rock stays for {rockTurns} turns, then crumbles back into plain soil. | Click to select, then choose a plot |
| Stone Conversion | Pick a plant. It wilts and regrows as the other team's plant: X becomes O, or O becomes X. | Click to select, then choose a plant |

Accuracy rule: before writing the strings, read the real skill rules in the game logic and `docs/design.md`. If a sentence says something the code does not do (for example who can be targeted, or the real zone size or rock lifetime), change that sentence as little as possible so it is true, and list each change in the task summary. A wrong description is worse than none.

State texts stay as in v3 section 8: `Ready`, `Selected`, `Ready in N turns` (`Ready in 1 turn`), `Wait for your turn`.

### 4.4 Tooltip

- One shared element for the whole HUD (`role="tooltip"`), referenced by `aria-describedby` on the button it belongs to. `pointer-events: none`. Width 340 to 372 px, same glass tokens, content: skill title, state text, description, then the hint in smaller muted text.
- Opens on hover after about 120 ms and on `focus-visible` at once. Closes on pointer leave, blur, `Escape`, and when the skill is clicked. Touch: a long press of about 500 ms shows it and suppresses the click that would follow; a quick tap still activates the skill.
- It works on collapsed buttons, on expanded skill rows, and (long press only) on the slim bars of narrow windows.
- Placement is a pure function `tooltipPosition(anchorRect, tooltipSize, viewport)` returning `{ left, top, placement }`: below the anchor with a 12 px gap and horizontally centred on it; if it does not fit below, above; clamped so it keeps a 12 px margin from every viewport edge; if it is wider than the viewport minus 24 px it sits at the left margin.

### 4.5 View model

`hudViewModel(gameState, uiState, localPlayer)` stays the only place that decides strings and states. Add per card: `collapsed`, and per skill: `description`, `hint`, `state` (`ready`, `selected`, `cooling`, `waiting`), `stateText`, `cooldownProgress` (0 to 1), `cooldownTurns`, `ariaLabel`. A pure helper changes the collapsed flag of one team in `uiState`. The DOM only renders the view model.

### 4.6 Tests (pure, no browser)

1. View model: expanded and collapsed, every state of the table in 4.2, cooling with 1 and with 2 turns left (singular and plural), description and hint present for all four skills, and numbers in the descriptions equal the config constants.
2. `tooltipPosition`: below when there is room, flips above near the bottom, clamps at left and right, stays inside the viewport whenever it fits, and handles a tooltip wider than the viewport.
3. Persistence: read and write with a working storage stub, with a storage stub whose methods throw (still returns expanded), with garbage values.
4. Key handling pure helper: `C` toggles, ignored with modifiers, in inputs and on repeat.
5. Layout (`hud-layout`): collapsed and expanded at 1920 by 1080, 1280 by 720 and 800 by 600, and the slim-bar mode at 390 by 844: no two HUD rectangles overlap, all inside the viewport; at 1920 by 1080 the collapsed pill is at most 320 wide and 96 high and starts at the same left and top as the expanded card.
6. All existing HUD tests still pass.

## 5. Horizon haze

The idea: far things lose colour into the sky colour. One colour, one function, used by every layer, so everything fades the same way. No blur is used for this.

### 5.1 Constants

| name | value |
|---|---|
| `HAZE_COLOR` | `#eaf2e4` (234, 242, 228) |
| sky gradient, top to horizon | 0 percent `#4a90e2`, 45 percent `#7fbdf0`, 80 percent `#c9e2ec`, 100 percent `HAZE_COLOR`. Plain gradient, no dithering. All three levels. |
| ground fog colour | `#badca8` (186, 220, 168) |
| forest floor shade colour | `#144628` (20, 70, 40) |

The horizon is the projected far edge of the ground. The sky gradient runs from the top of the window to the horizon (not to the bottom of the window), so at narrow windows, where the horizon sits lower, the gradient stretches with it.

### 5.2 Depth reference

All depth positions are measured at the 16:9 reference view as a percent of the screen height below the projected far edge, then converted once to a world z with a helper `groundZAtScreenY` and kept as world values for every window shape (so the forest stays put in the world). In the author's model the far edge is at 21.3 percent from the top (the framing rule calls it 21).

| layer | below the far edge | haze at its base |
|---|---|---|
| far ridge (screen layer) | crest 8.6 percent above the far edge, about | 0.55, plus 0.30 fading out over the first 8.3 percent below the crest |
| near ridge (screen layer) | crest 5.8 percent above the far edge, about | 0.38, plus the same 0.30 fade |
| far canopy wall | base 0.55 percent | 0.42, plus a top fade of 0.28 (section 5.3) |
| tree row 1 (back) | 0.65 percent | 0.30 |
| tree row 2 | 2.1 percent | 0.14 |
| tree row 3 (front) | 3.6 percent | 0.0 |
| ground fog ends | 6.9 percent | see 5.4 |
| forest floor shade ends | 5.7 percent | see 5.5 |
| forest zone limit | 7.2 percent | meadow props stay in front of this line (section 6.7) |

### 5.3 `hazeAmount(z)` and the wall

`hazeAmount(z)` is a pure function of the world depth `z` of a thing's base. It linearly interpolates between these nodes (the wall base depth: 0.42; row 1: 0.30; row 2: 0.14; row 3: 0.0) and clamps outside them: 0.42 behind the wall base and 0.0 in front of row 3. Trees, undergrowth and wall strips use it. Output colour is `mix(spriteColour, HAZE_COLOR, amount)` per instance, applied before any brightness shift, keeping the alpha untouched.

The far canopy wall adds a top fade `wallTopHaze(v)` where `v` is the position inside the strip from the top (0) to the base (1): `0.28 * (1 - smoothstep(0, 1, v))`. So the tops of the far trees melt into the sky.

### 5.4 Soft ground edge (all levels, including Low)

`groundFogAmount(z) = 0.55 * (1 - smoothstep(zFar, zFogEnd, z))`, where `zFar` is the far edge z and `zFogEnd` is the z 6.9 percent of the screen height below it at the 16:9 reference (about 2.2 world units). It is 0.55 at the far edge and 0 from `zFogEnd` on. The ground colour is mixed toward the fog colour by this amount. Only the ground, not the sprites. This is the only haze item Low gets besides the sky gradient.

### 5.5 Forest floor shade (High only)

`floorShadeAmount(z)`: 0.20 times `smoothstep(zFar, zFar + 0.9 percent, z)` times `(1 - smoothstep(zFar + 3.0 percent, zFar + 5.7 percent, z))`, where the percent offsets are converted to world z at the reference view like the other depths. Mixed into the ground with the floor shade colour. It makes the ground between the trunks sit in shade and fades out before the meadow starts.

### 5.6 Ridges (Medium and High)

Two soft ridges replace the old flat hill band (remove it and its blur, because it is the green band the owner dislikes). They are screen layers behind the wall, above the ground, drawn from the crest down to the horizon. The crest is a sum of two sines. Measure them in virtual pixels: screen x times 1080 divided by the screen height, so the shape does not change with the window size. The height above the horizon is `zoomK` times `H / 1080` times the value below.

| ridge | colour | height above the horizon in virtual px | alpha feather at the crest | haze |
|---|---|---|---|---|
| far | `#96cc9c` (150, 204, 156) | 93 - 16 sin(x/330 + 1.1) - 8 sin(x/140 + 0.4) | 40 px | 0.55 |
| near | `#7abe80` (122, 190, 128) | 63 - 11 sin(x/230 + 2.3) - 6 sin(x/95 + 1.7) | 30 px | 0.38 |

Alpha is 0 at the crest and rises to 1 over the feather width with a smoothstep (a soft crest, no blur pass). Colour is `mix(ridgeColour, HAZE_COLOR, h)` with `h = hazeBase + 0.30 * (1 - clamp(depthBelowCrest / 90, 0, 1))` (90 virtual px, also scaled). That gives crests at about 10.6 to 15.0 percent (far) and 14.0 to 17.1 percent (near) from the top at 16:9.

### 5.7 Quality

| | Low | Medium | High |
|---|---|---|---|
| sky gradient to haze colour | yes | yes | yes |
| soft ground edge (5.4) | yes | yes | yes |
| ridges | no | yes | yes |
| wall and tree haze | no forest | yes | yes |
| forest floor shade | no | no | yes |
| blur used for any of this | no | no | none (the existing depth of field is not changed) |

### 5.8 Tests (pure)

`hazeAmount` at its nodes and between them, clamped outside, non-increasing toward the camera. `wallTopHaze(0) = 0.28`, `wallTopHaze(1) = 0`, monotone. `groundFogAmount` is 0.55 at the far edge, 0 at `zFogEnd` and in front of it, monotone. `floorShadeAmount` is 0 at the far edge, at most 0.20 everywhere, 0.20 on its plateau, 0 at its end and in front. Sky stops: the last colour equals `HAZE_COLOR` (one source), first stop at 0, last at 1, same on all levels. Horizon fraction at 16:9 equals the projected far edge (about 0.213, tolerance 0.005) and grows as the window narrows. Ridge crest: within the ranges above at 16:9 (tolerance 0.4 percent), and the height above the horizon scales with `zoomK`. Quality table: ridges off, on, on; floor shade off, off, on; the table has the same keys at every level.

## 6. The forest

Reference: `scene-forest-high.jpg`, `scene-forest-medium.jpg`, `forest-sprites.png`.

### 6.1 Sprites (already in `assets/3d/v3/`, manifest entries already added by the installer)

| manifest key | frames | frame size (art px) | anchor (ground point) | what it is |
|---|---|---|---|---|
| `tree-pine` | 3 | 32 by 64 | 16, 62 | pine: tall, medium, small |
| `tree-oak` | 2 | 56 by 58 | 28, 56 | broad oak, two looks |
| `tree-birch` | 2 | 30 by 58 | 15, 56 | birch, two looks |
| `tree-poplar` | 2 | 22 by 70 | 11, 68 | narrow poplar, two looks |
| `forest-wall-round` | 1 | 192 by 56 | bottom edge | seamless strip of round crowns, repeats sideways |
| `forest-wall-pine` | 1 | 192 by 64 | bottom edge | seamless strip of conifer tops, repeats sideways |
| `undergrowth` | 9 | 28 by 22 | 14, 21 | 0 fern, 1 small fern, 2 shrub, 3 shrub with berries, 4 shrub with flowers, 5 tall grass, 6 sapling, 7 log, 8 stump |

Anchors and notes are in `assets/forest-meta.json` (kept apart from `assets/v3-meta.json`, which is not touched). The old round trees (`trees`, anchor in `v3-meta.json`) stay as one more kind. Missing or wrong-size art only warns, never crashes.

### 6.2 Layers, from far to near

1. Sky gradient, then the two ridges (section 5.6).
2. Far canopy wall: strips of 192 art pixels (6 world units) side by side from x -44 to 44, seamless, at scale 1, base at the wall depth of section 5.2. Every third strip is the pine strip, the others the round one. Haze 0.42 plus the top fade.
3. Tree row 1, row 2, row 3 (section 6.3).
4. Undergrowth between and in front of the rows (section 6.4).
5. The meadow, fence, board as today.

### 6.3 Tree rows (`planForest`)

`planForest` is a pure, deterministic function (seed `20261002`) that returns the list of instances: `{ sheet, frame, x, z, mirror, brightness, hazeAmount }` plus the wall strips and the undergrowth. Same input, same output.

| row | base depth below far edge | step along x, High | step along x, Medium |
|---|---|---|---|
| 1 (back) | 0.65 percent | 1.03 world units | 1.54 |
| 2 | 2.1 percent | 1.21 | not used |
| 3 (front) | 3.6 percent | 1.54 | 2.32 |

- Walk each row from x -44 to 44. After each tree advance by `step` times a random factor between 0.55 and 1.45, so gaps vary and it never looks like a fence of lollipops. Add an x jitter of plus or minus 0.15 and a base depth jitter of plus or minus 0.09 world units.
- Kind weights: pine 3, oak 2, birch 1, poplar 2, old tree (`trees`) 1. Frame chosen at random among the sheet's frames. Random mirror (half of them). Brightness shift between 0.94 and 1.06. Scale is always exactly 1: variety comes from the sprite sizes, never from fractional scaling.
- Counts follow from the steps: High about 215 trees (tolerance 190 to 240), Medium about 95 (80 to 110), Low none.
- One instanced mesh per sheet (8 meshes at most: 5 tree sheets, undergrowth, 2 wall strips), cut-out alpha with depth writes so the rows overlap correctly. Use the same sprite placement path as the meadow trees so the pixel scale matches the plants.

### 6.4 Undergrowth

- Base depth between 1.6 and 6.6 percent below the far edge, random along x from -44 to 44, density 3.2 per world unit on High and 2.1 on Medium (about 280 and 185 items).
- Looks 0 to 6 with weights: fern 2, small fern 1, shrub 3, shrub with berries 1.5, shrub with flowers 1.5, tall grass 2, sapling 1. Plus a few logs and stumps placed by the same seeded generator: 3 on High, 1 on Medium (alternating log and stump), at depths 4.0 to 7.0 percent.
- Uses `hazeAmount(z)` like the trees.

### 6.5 Shadows

Medium: soft blob shadows under tree rows and under shrubs, logs, stumps, saplings (not ferns or tall grass), using the existing blob shadow code. High: the existing long sun shadows (sheared silhouettes toward the lower right) for the trees and for shrubs, logs, stumps, saplings, instanced, one extra draw call per sheet. Low: none.

### 6.6 Look rules

Trees in the rows 2 and 3 and the undergrowth are crisp. The wall and the back row are paler by haze only. On High the existing gentle depth of field may soften the far wall slightly (the reference picture does that too); do not change its settings. Medium has no blur at all.

### 6.7 The forest zone and the meadow

The forest zone is everything with a base depth less than 7.2 percent below the far edge at the reference view (a world z, `FOREST_ZONE_Z`). On Medium and High the scene builder skips every meadow item (far-edge trees, flowers, bushes, hay bales, grass tufts, mushrooms) whose base is inside the zone. `planMeadow` itself is not changed, so its own tests keep passing; a small pure helper filters its result. Low draws no scenery, so nothing changes there.

### 6.8 Clouds

The tallest crowns reach about 11 percent from the top and the wall about 12 percent. Every cloud must stay visible: if an existing cloud visibility test fails because the forest now overlaps the lowest clouds, move the clouds up (a smaller fraction from the top) and do not lower the forest. Name the test in the summary.

### 6.9 Tests (pure)

`planForest`: same output twice; counts per level inside the ranges above; every row base depth within 0.12 world units of its row depth; in every row the first tree is at x -43 or less and the last at x 40 or more; per row the standard deviation of the gaps divided by their mean is between 0.15 and 0.40 and no two trees of a row closer than 0.2; kind shares within 0.10 of the weights on High and within 0.14 on Medium; about half mirrored (0.35 to 0.65); brightness between 0.94 and 1.06; scale 1 for all; wall strips 15, exactly 6.0 apart, every third a pine strip; undergrowth counts within 20 percent of density times 88, all seven regular looks used on High, 3 and 1 logs and stumps. Forest zone helper: removes at least one item from a `planMeadow` result on Medium and High, no kept item lies inside the zone, and keeps everything on Low. Every new manifest key loads; a missing one warns and does not crash. Quality table: tree rows 0, 2, 3; undergrowth 0, 2.1, 3.2; wall off, on, on.

## 7. The new quality table rows

These rows join the one table in `src/render3d/quality.js`. Nothing else may test the level name.

| feature | low | medium | high |
|---|---|---|---|
| sky gradient to the haze colour | on | on | on |
| soft ground edge (fog) | on | on | on |
| ridges | off | on | on |
| far canopy wall | off | on | on |
| tree rows (steps in world units) | none | rows 1 and 3 (1.54, 2.32) | rows 1, 2, 3 (1.03, 1.21, 1.54) |
| undergrowth per world unit | 0 | 2.1 | 3.2 |
| forest floor shade | off | off | on |
| tree shadows | none | soft blob | long sun shadows |
| HUD cards collapsible | slim bars below 700 px, else yes | yes | yes |

## 8. Performance and tests

- No per-frame allocation. The forest is static: it is built once per quality change, drawn with a handful of instanced meshes, and only the haze uniforms change when the window or the quality changes.
- Switching quality at runtime rebuilds only the forest and the haze layers, disposes replaced geometries, textures and materials, and never resets the game.
- Every number in this document that the code uses lives in one named constant, used by the code and by the tests.
- Pure helpers with unit tests: `fitView`, `zoomK`, ground bounds, `groundZAtScreenY`, `hazeAmount`, `wallTopHaze`, `groundFogAmount`, `floorShadeAmount`, ridge crest, `planForest`, forest zone filter, `SKILL_INFO` view model, `tooltipPosition`, collapsed-state storage, key helpers, `fullscreenViewModel`, `hud-layout` for collapsed and expanded and for the top bar.
- All existing tests must still pass. If a test fails because the new behaviour is intended, change only that expectation and say which one and why. Never delete or weaken a test to make it pass.
- The builder can take screenshots with `bash tools/shots.sh` (see `docs/shots.md`) and must look at them as the task says. Software rendering shows layout, colour, density and overlaps, not speed: the builder must not invent frame rates. FPS is measured by the owner (section 9).

## 9. Visual QA for the owner (after the last task)

Hard refresh first (Ctrl+Shift+R). Use `?quality=low`, `?quality=medium`, `?quality=high` and `?fps=1`.

1. Wide window: no black bars at any width. Drag the window narrower and taller: the whole field always stays visible, nothing cut off. Try the Fullscreen button and the F key, and leave with Escape: the label follows.
2. Phone shape (browser device mode, portrait): the field, the curb and a small margin are visible, the cards are slim bars.
3. HUD: collapse each card with its chevron and with the shortcut key; reload the page and check it is remembered; click the skills while collapsed; hover (or Tab to) each skill and read its description; Escape closes the tooltip; the opponent's skills show Wait for your turn but still explain themselves.
4. Forest on High: a real forest, uneven gaps, tall and short trees, ferns and shrubs at the feet; far trees pale, near trees crisp. Compare with `scene-forest-high.jpg`.
5. Forest on Medium: lighter, no blur anywhere. Low: no forest, no hills.
6. Horizon on all three levels: no hard line between meadow, trees and sky; the grass edge fades.
7. Clouds are still visible above the forest.
8. FPS on High with `?fps=1` at 1920 by 1080: wait 30 seconds, write down the lowest and the typical number, and send them. If it is below 60, cut costs in this order: cloud shadow layer resolution, long shadow count, bloom, depth of field, then the forest shadows.
9. Console shows no errors.

## 10. Do not

- Do not put the forest, ridges or undergrowth on Low.
- Do not scale pixel sprites by fractional factors at rest. Trees and wall strips are scale 1.
- Do not blur anything on Medium or Low. Do not change the depth of field settings.
- Do not dither the sky.
- Do not add a setting for a fixed aspect ratio. The view is always Auto.
- Do not put anything on a plot except a plant, a rock or a mark. Meadow items stay in front of the forest zone line.
- Do not change game rules, networking or cell numbering.
- Do not add libraries, fonts or network requests for art. Everything is vendored.
- Do not invent measurements.
