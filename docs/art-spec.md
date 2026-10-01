# Gomoku Tales: Art Spec

Every art file the game can load, with its size and frames, the rules the
art must follow, and a prompt template for an AI image generator. The game
runs with no art files at all: each missing file is replaced by a generated
placeholder. Real art is added by putting a PNG at the listed path, with no
code changes. See docs/art-direction-hd2d.md section H.

## 1. How a file is loaded

- `assets/manifest.json` lists every asset by name with its `file` (relative
  to `assets/`), `use`, `width` and `height` (the size of one frame in
  pixels), `frames` (frame count) and `frameMs` (time per frame; 0 means the
  frames are still variants, not an animation).
- A sprite sheet has all frames in one row, left to right, with no gaps and
  no padding. The whole file is `width x frames` pixels wide and `height`
  pixels tall.
- The file must have exactly that size. A missing file is silent and shows
  the placeholder. A file of the wrong size is refused with a warning in the
  browser console and the placeholder is shown instead. 3D files must also
  have the frame count listed below, because the 3D code is written for it.
- Final files are PNG with real alpha transparency. Magenta is only the key
  in generated images before cleaning (section 4).
- `use` says what draws the file: `2d` is the old 2D renderer
  (`?render=2d`), `hud` is the 2D HUD on top of both renderers, `3d` is the
  3D world (the default).
- After adding or changing a file, reload the page and look at the console:
  no warning means the file was accepted.

## 2. Every art file

Sizes are one frame, width x height in pixels. "Sheet" is the size of the
whole file. Frame times come from src/config.js and must stay the same in
the manifest (a test checks this).

### 3D world (`use: 3d`)

| File | Frame size | Frames | Frame time | Sheet | Notes |
|---|---|---|---|---|---|
| `3d/board-top.png` | 480x480 | 1 | - | 480x480 | Top face of the wooden board. 15x15 cells of exactly 32 px. Grid lines sit on the cell borders; a dark border on the outer 4 px. Opaque. Row 0 is the far edge. |
| `3d/piece-x.png` | 32x32 | 1 | - | 32x32 | X piece of Wind Rabbit: a young twig or vine sprout in a little blue seed pot. Stands on the bottom row. |
| `3d/piece-o.png` | 32x32 | 1 | - | 32x32 | O piece of Earth Bear: a round closed flower bud on a leafy stem in a little red seed pot. Stands on the bottom row. |
| `3d/piece-rock.png` | 32x32 | 1 | - | 32x32 | Rock from Terrain Creation: a grey boulder with a crack and a bit of moss. Sits on the bottom row. |
| `3d/wind-rabbit-idle.png` | 96x96 | 4 | 220 ms | 384x96 | White rabbit with a blue scarf. Idle bob: body sinks 0, 1, 2, 1 px while the feet stay planted. Loops. |
| `3d/wind-rabbit-cast.png` | 96x96 | 4 | 140 ms | 384x96 | Casting a wind skill: gathers power, raises paws, pale blue wind sparkles. Plays once and holds the last frame. |
| `3d/wind-rabbit-win.png` | 96x96 | 2 | 300 ms | 192x96 | Happy: paws up, ^ ^ eyes, a little jump with golden stars on frame 2. Loops. |
| `3d/wind-rabbit-lose.png` | 96x96 | 2 | 300 ms | 192x96 | Sad: drooping ears, closed eyes, frown, a tear on frame 2. Loops. |
| `3d/earth-bear-idle.png` | 96x96 | 4 | 220 ms | 384x96 | Sturdy brown bear with a little sprout on its head. Idle bob like the rabbit. Loops. |
| `3d/earth-bear-cast.png` | 96x96 | 4 | 140 ms | 384x96 | Casting an earth skill: gathers power, raises paws, golden and green earth sparkles. Plays once and holds the last frame. |
| `3d/earth-bear-win.png` | 96x96 | 2 | 300 ms | 192x96 | Happy: paws up, ^ ^ eyes, a little jump with golden stars on frame 2. Loops. |
| `3d/earth-bear-lose.png` | 96x96 | 2 | 300 ms | 192x96 | Sad: head sprout wilts, closed eyes, frown, a tear on frame 2. Loops. |
| `3d/flower-pink.png` | 16x16 | 1 | - | 16x16 | Two small pink wildflowers with yellow centres on thin stems. Instanced many times on the hill. |
| `3d/flower-yellow.png` | 16x16 | 1 | - | 16x16 | Two small yellow wildflowers with orange centres. |
| `3d/flower-white.png` | 16x16 | 1 | - | 16x16 | Two small white daisies with golden centres. |
| `3d/flower-blue.png` | 16x16 | 1 | - | 16x16 | Two small pale blue wildflowers with cream centres. |
| `3d/grass-tuft.png` | 16x16 | 1 | - | 16x16 | A tuft of grass blades, no outline (it blends into the hill). |
| `3d/cloud.png` | 48x20 | 4 | still | 192x20 | Four different puffy white cloud shapes, one per frame (variants, not an animation). Pale blue-grey shading on the bottom edge. No outline. Drawn with bigger pixels (CLOUD_PX_WORLD) because they are far away. |
| `3d/decal-hover.png` | 16x16 | 1 | - | 16x16 | Flat on the board cell under the pointer: a 1 px bright cream frame around a soft warm see-through fill. |
| `3d/decal-select.png` | 16x16 | 1 | - | 16x16 | The stone chosen for a skill: a 2 px pale yellow frame, empty inside. |
| `3d/decal-win.png` | 16x16 | 1 | - | 16x16 | Cells of the winning line: a 2 px gold frame with a faint gold fill. |
| `3d/decal-dash-target.png` | 16x16 | 1 | - | 16x16 | Wind Dash target cell: a 2 px red frame with a translucent red fill. |
| `3d/decal-whirl.png` | 16x16 | 1 | - | 16x16 | Wind Dash source stone: three pale blue arcs swirling around the centre, transparent elsewhere. |
| `3d/decal-zone.png` | 16x16 | 1 | - | 16x16 | One cell of a Tornado Zone: pale translucent wind with a dashed white edge, so 3x3 neighbouring cells read as one area. |

### HUD, both renderers (`use: hud`)

| File | Frame size | Frames | Frame time | Sheet | Notes |
|---|---|---|---|---|---|
| `panel-wind-rabbit.png` | 240x372 | 1 | - | 240x372 | Wind Rabbit's player panel: an old wooden or stone signboard frame with a blue accent. The middle stays plain, text and buttons are drawn on it. In the 3D game it is drawn scaled to 212x222, so keep the frame simple enough to stretch. |
| `panel-earth-bear.png` | 240x372 | 1 | - | 240x372 | Earth Bear's panel, the same with a red accent. |
| `portrait-wind-rabbit.png` | 96x96 | 1 | - | 96x96 | Head and shoulders of Wind Rabbit. Shown on the 2D panel only (the 3D game shows the character in the world). |
| `portrait-earth-bear.png` | 96x96 | 1 | - | 96x96 | Head and shoulders of Earth Bear. 2D panel only. |
| `icon-wind-dash.png` | 32x32 | 1 | - | 32x32 | Wind Dash: a sprout piece streaking sideways with blue wind lines behind it. |
| `icon-tornado-zone.png` | 32x32 | 1 | - | 32x32 | Tornado Zone: a small pale blue tornado over a 3x3 grid. |
| `icon-terrain-creation.png` | 32x32 | 1 | - | 32x32 | Terrain Creation: a grey boulder falling onto a board cell with dust. |
| `icon-stone-conversion.png` | 32x32 | 1 | - | 32x32 | Stone Conversion: a sprout turning into a flower bud, with a curved arrow and a golden glow. |

### Old 2D renderer only (`use: 2d`, `?render=2d`)

| File | Frame size | Frames | Frame time | Sheet | Notes |
|---|---|---|---|---|---|
| `background.png` | 960x540 | 1 | - | 960x540 | Windy Spring Breeze Hill seen from the front: green hill, wildflowers, blossoming trees, clear blue sky, white clouds. The board covers the middle 372x372. Opaque. |
| `board.png` | 372x372 | 1 | - | 372x372 | Wooden board with its frame: a 6 px frame around 15x15 cells of 24 px. |
| `stone-x.png` | 24x24 | 1 | - | 24x24 | X piece (sprout), small version of `3d/piece-x.png`, centred in the cell. |
| `stone-o.png` | 24x24 | 1 | - | 24x24 | O piece (flower bud), small version of `3d/piece-o.png`. |
| `rock.png` | 24x24 | 1 | - | 24x24 | Rock, small version of `3d/piece-rock.png`. |
| `tornado.png` | 72x72 | 4 | 120 ms | 288x72 | Tornado Zone overlay spanning 3x3 cells: a translucent spinning whirlwind. Loops. |

### Not loaded from files

These stay generated by code and need no art: the sky gradient, the soft
blob shadows under sprites, the glow halo behind the current player's
character, the wind streaks, effect particles (sparkles, dust, swirls), the
low-poly terrain, distant hills and blossoming trees, and the board's sides.

## 3. Pixel density rule

- 3D: one art pixel is `PX_WORLD` = 1/32 world unit for every sprite and
  texture, so all pixels look the same size on screen. One board cell is
  1 world unit, so a cell is 32 art pixels: a 32x32 piece is one cell wide,
  a 96x96 character is three cells wide, and the 480x480 board top is
  15 cells of 32 px. Decals (16x16) are stretched over one cell, so their
  pixels are twice as big; keep them simple shapes. Clouds use bigger
  pixels on purpose (`CLOUD_PX_WORLD` = 1/8) because they are far away.
- Never draw at a different scale and resize. Draw on the true pixel grid
  at the listed size. No half pixels, no anti-aliasing, no blur, no
  dithering gradients that turn to noise when the camera moves.
- Sprites stand upright and their feet stand on the bottom row of the
  frame. Centre them horizontally. Leave the same feet line in every frame
  of a sheet so the sprite does not jump.
- Draw sprites as seen from the front. The game stretches them in height
  (`SPRITE_STRETCH_Y`) to cancel the tilted camera, so do not squash them.
- Sprites are cut out with an alpha test: every pixel is either fully
  opaque or fully transparent. Only decals and the 2D tornado overlay may
  use see-through pixels.
- 2D: art is drawn 1:1 at the 960x540 internal resolution, at the listed
  sizes.

## 4. Palette rules

- Limited palette: at most 16 colours per sprite (32 for the board top, the
  panels and the 2D background), picked from one shared game palette. Bright
  saturated candy colours. Use 2 or 3 flat shades per material (light, base,
  dark), not smooth gradients.
- Bold dark outline: every sprite (pieces, rock, characters, flowers, icons,
  portraits) has a 1 px outline in the dark plum `#2b1d3a` around its outer
  silhouette, so it stands out on the wooden board and the grass. Inner
  lines may use a darker shade of the local colour. Grass tufts, clouds, the
  board top and decals have no outline.
- Team colours: Wind Rabbit and X are blue (`#3b8cff`, pot `#4a8fe0`, dark
  `#2f63b0`, light `#9ccaff`). Earth Bear and O are red (`#ff4b5c`, pot
  `#e85a6e`, dark `#a8304a`, light `#ffa8b4`). Gold for wins and stars
  `#ffe14d`. Wood `#cf975c`, `#c48a52`, grid `#6b3f1d`. Leaves `#6cc04a`,
  `#3f8f3a`.
- Magenta transparency key: generated images use pure magenta `#FF00FF` as
  the background and for every pixel that must be transparent. Magenta must
  never appear in the art itself. When cleaning, replace every `#FF00FF`
  pixel with full transparency.
- Cleaning AI art before it goes into `assets/`:
  1. Downscale to the true pixel grid with nearest neighbour (find the
     generator's pixel size, then sample one pixel per art pixel).
  2. Crop or pad to the exact frame size and line the frames up in one row.
  3. Reduce the colours to the limited palette (no near-duplicates).
  4. Turn `#FF00FF` into transparency; make every other pixel fully opaque.
  5. Check the 1 px dark outline is closed, and the feet line is the same
     in every frame.
  6. Save as PNG and reload the game; the console must show no warning.

## 5. Prompt templates

Use the style block at the start of every prompt, then the asset prompt.
Generators rarely hit an exact pixel grid, so ask for the art on a big,
clear grid and clean it afterwards (section 4). Words in `{braces}` are
filled in from the table above.

**Style block (all assets):**

> Cute 16-bit pixel art in the HD-2D style of Octopath Traveler, bright
> saturated candy colours, limited palette of at most 16 colours, flat
> shading with 2 or 3 shades per colour, bold 1 pixel dark plum (#2b1d3a)
> outline around the silhouette, crisp hard pixel edges, no anti-aliasing,
> no blur, no gradients, no text, no watermark. Drawn on an exact
> {width}x{height} pixel grid, shown enlarged with each art pixel as a
> perfect square. Solid pure magenta (#FF00FF) background, magenta used
> nowhere else.

**Sprite sheet block (add for assets with more than 1 frame):**

> A sprite sheet of {frames} frames in one horizontal row, left to right,
> each frame exactly {width}x{height} pixels, no gaps and no borders
> between frames, the same character at the same size and position in
> every frame, feet on the same bottom line in every frame.

### 3D world

- `3d/board-top.png`: "Top-down view of a square wooden game board, warm
  honey-coloured horizontal planks with fine pixel wood grain, a 15 by 15
  grid of thin dark brown lines with every cell exactly 32 pixels, a darker
  4 pixel border around the edge, flat and evenly lit, seen straight from
  above, fills the whole 480x480 image, no background visible."
  (Opaque: no magenta needed.)
- `3d/piece-x.png`: "A single game piece standing upright: a young green
  twig sprout with two round leaves and a curling vine tip, growing out of a
  small round blue seed pot, seen from the front, centred, the pot touching
  the bottom edge, 32x32 pixels."
- `3d/piece-o.png`: "A single game piece standing upright: a round closed
  pink and red flower bud on a short leafy stem, growing out of a small
  round red seed pot, seen from the front, centred, the pot touching the
  bottom edge, 32x32 pixels."
- `3d/piece-rock.png`: "A chunky round grey boulder with a crack and a
  small patch of green moss, seen from the front, sitting on the bottom
  edge, centred, 32x32 pixels."
- `3d/wind-rabbit-{pose}.png`: "Wind Rabbit, a cute small white rabbit
  with long ears and a fluttering blue scarf, a gentle wind mage, full body
  seen from the front, standing, 96x96 pixel frames. {pose line}"
  Pose lines:
  - idle: "4 frame idle breathing bob: the body sinks 0, 1, 2 then 1 pixel
    while the feet stay planted, the scarf flutters a little."
  - cast: "4 frame spell cast: crouches to gather power, raises both paws,
    pale blue wind sparkles appear and grow, smiling; the last frame is
    the strongest pose."
  - win: "2 frame victory pose: paws up, happy ^ ^ eyes, big smile; in frame
    2 a small jump with golden stars around."
  - lose: "2 frame sad pose: drooping ears, closed worried eyes, frown, paws
    down; in frame 2 a small blue tear."
- `3d/earth-bear-{pose}.png`: "Earth Bear, a cute sturdy brown bear with a
  light muzzle and a little green sprout growing on its head, a calm earth
  mage, full body seen from the front, standing, 96x96 pixel frames.
  {pose line}" Pose lines as for Wind Rabbit, with "golden and green earth
  sparkles" for cast and "the head sprout wilts" for lose.
- `3d/flower-{colour}.png`: "Two tiny {colour} wildflowers with {centre}
  centres on thin green stems of different heights, seen from the front,
  stems touching the bottom edge, 16x16 pixels." Colours: pink with yellow
  centres, yellow with orange centres, white daisies with golden centres,
  pale blue with cream centres.
- `3d/grass-tuft.png`: "A small tuft of bright green grass blades, two
  greens, no outline, blades touching the bottom edge, 16x16 pixels."
- `3d/cloud.png`: "4 different small puffy white cartoon clouds, one per
  frame, flat white with a pale blue-grey shade along the bottom edge, no
  outline, each frame 48x20 pixels, in one horizontal row." (Variants, not
  an animation.)
- `3d/decal-{kind}.png`: "A flat square tile marker seen from straight
  above, 16x16 pixels, {kind line}, transparent (magenta) where the board
  should show through." Kind lines:
  - hover: "a 1 pixel bright cream border around a faint warm yellow fill"
  - select: "a 2 pixel pale yellow border, empty inside"
  - win: "a 2 pixel gold border with a faint gold fill"
  - dash-target: "a 2 pixel bright red border with a light red fill"
  - whirl: "three pale blue curved wind arcs swirling around the centre"
  - zone: "a pale blue-white wind haze fill with a dashed white edge"
  Note: the fills are see-through. Generators cannot make partial
  transparency, so generate the solid shapes and set the fill alpha (about
  30 to 45 percent) when cleaning.

### HUD

- `panel-{character}.png`: "An old weathered wooden signboard frame, tall
  rectangle 240x372 pixels, thick carved border with nails and a
  {colour} painted accent and a small {emblem} at the top, the inner area
  plain darker wood for text, seen straight on." Wind Rabbit: blue accent,
  a little wind swirl emblem. Earth Bear: red accent, a little leaf and
  stone emblem.
- `portrait-{character}.png`: "Head and shoulders portrait of {character
  line}, facing the viewer, friendly expression, 96x96 pixels." Use the
  character lines from the 3D sheets.
- `icon-{skill}.png`: "A square skill icon, 32x32 pixels, a rounded frame
  in {team colour}, showing {skill line}, detailed but readable at small
  size." Skill lines:
  - wind-dash: "a green sprout piece dashing sideways with blue speed lines
    and a wind trail"
  - tornado-zone: "a small pale blue tornado spinning over a 3x3 grid of
    board cells"
  - terrain-creation: "a grey boulder falling onto a board cell with brown
    dust clouds"
  - stone-conversion: "a green sprout piece turning into a pink flower bud,
    a curved arrow between them and a golden glow"

### Old 2D renderer

- `background.png`: "A wide 960x540 side view of a grassy green spring hill
  with patches of wildflowers, a few pink blossoming trees, a clear blue sky
  and soft white clouds, gentle wind lines, the middle area calm and plain
  because a game board covers it." (Opaque: no magenta needed.)
- `board.png`: "A square wooden game board seen straight from above,
  372x372 pixels, a 6 pixel dark wooden frame around a 15 by 15 grid of
  24 pixel cells with thin dark brown lines, warm honey wood."
  (Opaque.)
- `stone-x.png`, `stone-o.png`, `rock.png`: as `3d/piece-x.png`,
  `3d/piece-o.png` and `3d/piece-rock.png`, but "seen from slightly above,
  centred, 24x24 pixels".
- `tornado.png`: "4 frame loop of a translucent pale blue whirlwind seen
  from above, spinning, each frame 72x72 pixels." The whirlwind is
  see-through: set its alpha (about 50 percent) when cleaning.
