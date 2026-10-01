# HD-2D look lab

The lab is a test scene for the HD-2D look (docs/art-direction-hd2d.md). It is separate from the game and not playable.

## Open it

1. In the project folder run: `python3 -m http.server 8000`
2. Open http://localhost:8000/hd2d-lab.html

Everything loads from the local server; no internet is needed.

## Keys

- **Q**: cycle the quality level HIGH, MEDIUM, LOW, back to HIGH. The level name and the FPS show in the top left corner.
- **Mouse**: move over the board to see the hover highlight on the cell under the pointer. The cell shows in the top left corner.

## Quality levels (section E)

| Level | Blur | Bloom | Vignette | Shadows |
|---|---|---|---|---|
| HIGH | depth of field (BokehPass) | yes | yes | real shadow maps and blob shadows |
| MEDIUM (default) | tilt shift | half resolution | yes | blob shadows only |
| LOW | none | no | no | blob shadows only |

Tone mapping is on at every level. When the average frame time stays above TARGET_FRAME_MS for 3 seconds, the lab steps down one level by itself and the corner shows "(auto, slow frames)". The pixel ratio is capped at RENDER_SCALE. All values are in src/config.js.

## What to look at

- **Crisp pixels**: the rabbit, the bear, the stones, the rock and the board grid stay sharp with no shimmer, at every level.
- **Focus**: the board centre is sharp. On HIGH the distant hills, clouds and sky are soft and the board edges very slightly soft. On MEDIUM the top and bottom of the screen are softer than the middle, a miniature diorama feel.
- **Bloom**: subtle. Only bright things (white clouds, the white rabbit, the hover highlight) get a faint glow. Nothing should look washed out.
- **Vignette**: corners a little darker on HIGH and MEDIUM, gone on LOW.
- **Tone mapping**: colours stay bright and candy coloured, no harsh clipped whites, and they look about the same on LOW as on MEDIUM.
- **Shadows**: on HIGH the board, trees and terrain cast soft sun shadows. On MEDIUM and LOW only the soft blobs under sprites remain.
- **Speed**: FPS near 60 at MEDIUM or LOW at 1080p on integrated graphics. Pressing Q may hitch once while shaders rebuild.
- **Hover**: the glowing decal sits on the cell under the pointer at every level.
