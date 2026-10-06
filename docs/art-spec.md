# Gomoku Tales: Art Spec

Every art file the game can load, with its size and frames, the rules the
art must follow, and a prompt template for an AI image generator. The game
runs with no art files at all: each missing file is replaced by a generated
placeholder. Real art is added by putting a PNG at the listed path, with no
code changes. See docs/art-direction-hd2d.md section H.

The 3D game's farm, meadow, sky, plants, rocks, marks and HUD portraits are
the Farmland v3 pack in `assets/3d/v3/`, listed with sizes and anchors in
docs/art-direction-v3.md section 2 (tuning data in `assets/v3-meta.json`).
This file lists the rest: the world character sheets, the skill icons and
the old 2D renderer's art. The old wood board, the pot pieces, the 16 px
flowers, grass tuft and clouds and the 16 px decals of the first 3D world
were retired in Farmland v3 part 10.

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
  (`?render=2d`, its canvas panels and 96 px portraits included), `hud` is
  the skill icons and v3 portraits of either renderer's HUD, `3d` is the 3D
  world (the default). The 3D game loads only `3d` and `hud` files
  (`USES_3D` in src/render/assets.js), so the 2D files are never requested
  there.
- After adding or changing a file, reload the page and look at the console:
  no warning means the file was accepted.

## 2. Every art file

Sizes are one frame, width x height in pixels. "Sheet" is the size of the
whole file. Frame times come from src/config.js and must stay the same in
the manifest (a test checks this).

### 3D world characters (`use: 3d`)

Wind Rabbit and Earth Bear beside the board. They are switched off for now
(`SHOW_WORLD_CHARACTERS = false` in src/config.js, the HUD cards carry the
characters) but stay loaded, so setting the constant to `true` brings them
back.

| File | Frame size | Frames | Frame time | Sheet | Notes |
|---|---|---|---|---|---|
| `3d/wind-rabbit-idle.png` | 96x96 | 4 | 220 ms | 384x96 | White rabbit with a blue scarf. Idle bob: body sinks 0, 1, 2, 1 px while the feet stay planted. Loops. |
| `3d/wind-rabbit-cast.png` | 96x96 | 4 | 140 ms | 384x96 | Casting a wind skill: gathers power, raises paws, pale blue wind sparkles. Plays once and holds the last frame. |
| `3d/wind-rabbit-win.png` | 96x96 | 2 | 300 ms | 192x96 | Happy: paws up, ^ ^ eyes, a little jump with golden stars on frame 2. Loops. |
| `3d/wind-rabbit-lose.png` | 96x96 | 2 | 300 ms | 192x96 | Sad: drooping ears, closed eyes, frown, a tear on frame 2. Loops. |
| `3d/earth-bear-idle.png` | 96x96 | 4 | 220 ms | 384x96 | Sturdy brown bear with a little sprout on its head. Idle bob like the rabbit. Loops. |
| `3d/earth-bear-cast.png` | 96x96 | 4 | 140 ms | 384x96 | Casting an earth skill: gathers power, raises paws, golden and green earth sparkles. Plays once and holds the last frame. |
| `3d/earth-bear-win.png` | 96x96 | 2 | 300 ms | 192x96 | Happy: paws up, ^ ^ eyes, a little jump with golden stars on frame 2. Loops. |
| `3d/earth-bear-lose.png` | 96x96 | 2 | 300 ms | 192x96 | Sad: head sprout wilts, closed eyes, frown, a tear on frame 2. Loops. |

### Skill icons, both renderers (`use: hud`)

Drawn by the 2D canvas panels and by the 3D game's glass HUD (src/ui/hud.js).

| File | Frame size | Frames | Frame time | Sheet | Notes |
|---|---|---|---|---|---|
| `icon-wind-dash.png` | 32x32 | 1 | - | 32x32 | Wind Dash: a sprout piece streaking sideways with blue wind lines behind it. |
| `icon-tornado-zone.png` | 32x32 | 1 | - | 32x32 | Tornado Zone: a small pale blue tornado over a 3x3 grid. |
| `icon-terrain-creation.png` | 32x32 | 1 | - | 32x32 | Terrain Creation: a grey boulder falling onto a board cell with dust. |
| `icon-stone-conversion.png` | 32x32 | 1 | - | 32x32 | Stone Conversion: a sprout turning into a flower bud, with a curved arrow and a golden glow. |

### Character portraits and skill icons of the glass HUD (`use: 3d`, `assets/3d/v5/`)

The HUD card portrait belongs to the character, whichever side it plays
(`PORTRAIT_ART` in `src/ui/hud-view.js`). These files are drawn on a 64 px
grid (128 for the select portrait) and stored at a whole-number scale.

| File | Size | Grid | Notes |
|---|---|---|---|
| `cloud-eagle-avatar.png` | 512x512 | 128 px at 4x | Cloud Eagle on its select card. |
| `cloud-eagle-hud.png` | 256x256 | 64 px at 4x | Cloud Eagle's HUD portrait. |
| `sky-watch-icon.png` | 128x128 | 64 px at 2x | Sky Watch: an eagle eye over the field grid. |
| `cloud-icon.png` | 128x128 | 64 px at 2x | Cloud: a cloud over the field and a feather. |
| `portrait-jade-serpent.png` | 128x128 | 64 px at 2x | Jade Serpent's HUD portrait. |
| `icon-hiss.png` | 128x128 | 64 px at 2x | Hiss: a hissing serpent and a locked skill rune. |
| `icon-venom.png` | 128x128 | 64 px at 2x | Venom: venom drops wilting a red bud. |
| `portrait-wind-rabbit-v5.png` | 128x128 | 64 px at 2x | Wind Rabbit's HUD portrait (the 32 px `portrait-wind-rabbit-v3` stays in the v3 pack). |
| `icon-wind-dash-v5.png` | 128x128 | 64 px at 2x | Wind Dash: a seed riding a gust of petals between plots. |
| `icon-tornado-zone-v5.png` | 128x128 | 64 px at 2x | Tornado Zone: a tornado of petals and leaves over 3x3 plots. |
| `portrait-earth-bear-v5.png` | 128x128 | 64 px at 2x | Earth Bear's HUD portrait. |
| `icon-terrain-creation-v5.png` | 128x128 | 64 px at 2x | Terrain Creation: a boulder slamming into the soil with a shockwave. |
| `icon-stone-conversion-v5.png` | 128x128 | 64 px at 2x | Stone Conversion: a flower of no team reborn ochre brown (no team colours, since any character may be the opponent). |

The 32 px `icon-*.png` skill icons in `assets/` are kept for the 2D renderer (`?render=2d`); the glass HUD uses the 64 px grid files above.

### Old 2D renderer only (`use: 2d`, `?render=2d`)

| File | Frame size | Frames | Frame time | Sheet | Notes |
|---|---|---|---|---|---|
| `background.png` | 960x540 | 1 | - | 960x540 | Windy Spring Breeze Hill seen from the front: green hill, wildflowers, blossoming trees, clear blue sky, white clouds. The board covers the middle 372x372. Opaque. |
| `board.png` | 372x372 | 1 | - | 372x372 | Wooden board with its frame: a 6 px frame around 15x15 cells of 24 px. |
| `stone-x.png` | 24x24 | 1 | - | 24x24 | X piece: a young twig or vine sprout in a little blue seed pot, centred in the cell. |
| `stone-o.png` | 24x24 | 1 | - | 24x24 | O piece: a round closed flower bud on a leafy stem in a little red seed pot. |
| `rock.png` | 24x24 | 1 | - | 24x24 | Rock from Terrain Creation: a grey boulder with a crack and a bit of moss. |
| `tornado.png` | 72x72 | 4 | 120 ms | 288x72 | Tornado Zone overlay spanning 3x3 cells: a translucent spinning whirlwind. Loops. |
| `panel-wind-rabbit.png` | 240x372 | 1 | - | 240x372 | Wind Rabbit's player panel: an old wooden or stone signboard frame with a blue accent. The middle stays plain, text and buttons are drawn on it. |
| `panel-earth-bear.png` | 240x372 | 1 | - | 240x372 | Earth Bear's panel, the same with a red accent. |
| `portrait-wind-rabbit.png` | 96x96 | 1 | - | 96x96 | Head and shoulders of Wind Rabbit. Shown on the 2D panel only (the 3D HUD uses the v3 portraits). |
| `portrait-earth-bear.png` | 96x96 | 1 | - | 96x96 | Head and shoulders of Earth Bear. 2D panel only. |

### Not loaded from files

These stay generated by code and need no art: the sky gradient, the soft
blob shadows under sprites, the glow halo behind the current player's
character, effect particles (sparkles, soil puffs, petals), the far hills
and the curb's sides; in the 2D renderer also its wind streaks.

## 3. Pixel density rule

- 3D: one art pixel is `PX_WORLD` = 1/32 world unit for every sprite and
  texture, so all pixels look the same size on screen. One board cell is
  1 world unit, so a cell is 32 art pixels: a 96x96 character is three
  cells wide, and the 480x480 farm board is 15 cells of 32 px. The v3
  pack's own sizes are in docs/art-direction-v3.md section 2.
- Never draw at a different scale and resize. Draw on the true pixel grid
  at the listed size. No half pixels, no anti-aliasing, no blur, no
  dithering gradients that turn to noise when the camera moves.
- Sprites stand upright and their feet stand on the bottom row of the
  frame. Centre them horizontally. Leave the same feet line in every frame
  of a sheet so the sprite does not jump.
- Draw sprites as seen from the front. The game stretches them in height
  (`SPRITE_STRETCH_Y`) to cancel the tilted camera, so do not squash them.
- Sprites are cut out with an alpha test: every pixel is either fully
  opaque or fully transparent. Only the v3 plot marks and the 2D tornado
  overlay may use see-through pixels.
- 2D: art is drawn 1:1 at the 960x540 internal resolution, at the listed
  sizes.

## 4. Palette rules

- Limited palette: at most 16 colours per sprite (32 for the 2D board, the
  panels and the 2D background), picked from one shared game palette. Bright
  saturated candy colours. Use 2 or 3 flat shades per material (light, base,
  dark), not smooth gradients.
- Bold dark outline: every sprite (pieces, rock, characters, flowers, icons,
  portraits) has a 1 px outline in the dark plum `#2b1d3a` around its outer
  silhouette, so it stands out on the soil and the grass. Inner
  lines may use a darker shade of the local colour. Clouds, the
  2D board and see-through overlays have no outline.
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

### 3D world characters

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

### Skill icons

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
- `stone-x.png`: "A young green twig sprout with two round leaves growing
  out of a small round blue seed pot, seen from slightly above, centred,
  24x24 pixels."
- `stone-o.png`: "A round closed pink and red flower bud on a short leafy
  stem growing out of a small round red seed pot, seen from slightly above,
  centred, 24x24 pixels."
- `rock.png`: "A chunky round grey boulder with a crack and a small patch of
  green moss, seen from slightly above, centred, 24x24 pixels."
- `tornado.png`: "4 frame loop of a translucent pale blue whirlwind seen
  from above, spinning, each frame 72x72 pixels." The whirlwind is
  see-through: set its alpha (about 50 percent) when cleaning.
- `panel-{character}.png`: "An old weathered wooden signboard frame, tall
  rectangle 240x372 pixels, thick carved border with nails and a
  {colour} painted accent and a small {emblem} at the top, the inner area
  plain darker wood for text, seen straight on." Wind Rabbit: blue accent,
  a little wind swirl emblem. Earth Bear: red accent, a little leaf and
  stone emblem.
- `portrait-{character}.png`: "Head and shoulders portrait of {character
  line}, facing the viewer, friendly expression, 96x96 pixels." Use the
  character lines from the 3D character sheets.
