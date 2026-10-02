# HD-2D look lab

The lab is a test scene for the HD-2D look (docs/art-direction-hd2d.md). It is separate from the game and not playable.

## Open it

1. In the project folder run: `python3 -m http.server 8000`
2. Open http://localhost:8000/hd2d-lab.html

Everything loads from the local server; no internet is needed.

## Keys

- **Q**: cycle the quality level high, medium, low, back to high (`?quality=low|medium|high` picks one at start). The level name and the FPS show in the top left corner.
- **Mouse**: move over the board to see the hover highlight on the cell under the pointer. The cell shows in the top left corner.

## Quality levels (docs/art-direction-v3.md section 5)

| Level | Pixel ratio cap | Post effects | Shadows | Sky and background | Effect particles (live cap) | Blur behind menus |
|---|---|---|---|---|---|---|
| high | 2 | bloom, depth of field, vignette (warm grade comes later) | sun shadow maps and blob shadows | clouds, wind and moving background | all (220) | yes |
| medium (default) | 1.5 | none, no blur at all | blob shadows | still clouds, no wind | about a quarter (60) | yes |
| low | 1 | none | none | plain sky, no scenery, flowers or hills | none (0) | no |

Tone mapping is on at every level. When the average frame time stays above TARGET_FRAME_MS for 3 seconds, the lab steps down one level by itself and the corner shows "(auto, slow frames)". The levels are one table in src/render3d/quality.js; the timings are in src/config.js.

## What to look at

- **Crisp pixels**: the rabbit, the bear, the stones, the rock and the board grid stay sharp with no shimmer, at every level.
- **Focus**: the board centre is sharp. On high the distant hills, clouds and sky are soft and the board edges very slightly soft. Medium and low have no blur at all.
- **Bloom**: subtle. Only bright things (white clouds, the white rabbit, the hover highlight) get a faint glow. Nothing should look washed out.
- **Vignette**: corners a little darker on high, gone on medium and low.
- **Tone mapping**: colours stay bright and candy coloured, no harsh clipped whites, and they look about the same on low as on medium.
- **Shadows**: on high the board, trees and terrain cast soft sun shadows. On medium only the soft blobs under sprites remain; low has no shadows.
- **Speed**: FPS near 60 at medium or low at 1080p on integrated graphics. Pressing Q may hitch once while shaders rebuild.
- **Hover**: the glowing decal sits on the cell under the pointer at every level.
