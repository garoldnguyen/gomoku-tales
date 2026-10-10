# Gomoku Tales: HD-2D Art Direction (v2)

This file REPLACES these parts of docs/design.md wherever they disagree: the Canvas 2D rendering bullet in section 2, the layout in section 3.1, section 7 (art direction) and section 8 (effects). Rules (sections 4 and 5), online rooms (section 6), the screen flow in section 3 and the rule changes already written in docs/design.md stay exactly as they are. src/logic and src/net must not change for rendering reasons.

## A. The look
Reference: the HD-2D style of Octopath Traveler. Cute 16-bit pixel art sprites stand upright in a real 3D scene that has lighting, soft shadows and a fixed angled camera. A depth of field blur gives a miniature diorama feel, with warm light and a little bloom.
- The reference is a large studio production. We use the same recipe at hobby scale. Clean and charming beats detailed.
- Keep the pixel art rules from design.md: bright candy colours, bold dark outlines on sprites, cute.

## B. Camera
- One fixed perspective camera, narrow field of view (about 30 to 40 degrees), looking down at the board at about 50 to 60 degrees like a MOBA camera, centred on the board. Values live in src/config.js (CAMERA_FOV, CAMERA_PITCH_DEG, CAMERA_DISTANCE). No user rotation or zoom in version 2.
- Allowed motion: a very slight sway and screen shake on skill hits. Motion must never make pixels shimmer.
- 16:9 layout. In other window shapes, keep 16:9 and letterbox.

## C. Scene: Map 1, Windy Spring Breeze Hill
- Ground: low-poly rolling hill with grass colours, flat under the board. Patches of wildflowers (instanced billboards). A few blossoming trees. Distant hills. Sky gradient. White clouds drifting slowly. Light fog for depth.
- Board: a raised wooden slab with a 15x15 grid, sitting flat on the hill. Cell size in world units is CELL_SIZE in config.
- Characters: Wind Rabbit stands on the left of the board and Earth Bear on the right, as pixel sprites with an idle animation, a cast animation when their player uses a skill, and a win or lose pose at game over.
- Wind: faint wind streaks drift across the scene all the time. Grass and flowers may sway a little.

## D. Sprites
- A sprite is an upright plane that turns only around the vertical axis to face the camera. It does not tilt. Its feet stand on the ground point.
- Pixel density rule: one art pixel is PX_WORLD world units for every sprite, so all pixels look the same size.
- Textures: NearestFilter for magnification and minification, no mipmaps, alphaTest cutout edges, sRGB colour space.
- Every sprite has a soft blob shadow on the ground. Real shadow maps (board, trees, terrain) depend on the quality level.
- Lighting: a warm directional sun and a cool hemisphere fill so sprites pick up the scene tone. Normal maps for sprites are optional and come later.
- Starting sizes (change them in src/config.js and here together): character frames 96x96, pieces (X sprout, O flower bud) 32x32, rock 32x32, effect sprites 16x16 to 32x32, board texture 480x480 with NearestFilter. Animations are sprite sheets with all frames in one row.

## E. Post-processing and quality levels
- Use only the post-processing that ships with Three.js. Depth of field focused on the board (BokehPass, or the tilt shift shader pair for a cheaper miniature look). Subtle bloom on bright things only. Light vignette. Tone mapping.
- HIGH: depth of field, bloom, vignette, real shadow maps.
- MEDIUM (default): cheaper blur (tilt shift), bloom off or at half resolution, blob shadows only.
- LOW: no post-processing, blob shadows only.
- The Q key cycles the level and shows its name and the FPS on screen. When the average frame time stays above TARGET_FRAME_MS for 3 seconds, step down one level automatically.
- Cap the pixel ratio with RENDER_SCALE (1 to 1.5). Target 60 fps at 1080p on integrated graphics (for example AMD Radeon 780M) at MEDIUM or LOW.

## F. HUD and screens
- The HUD (player panels, skill buttons with cooldowns, status line, skill banners, winner text) stays 2D. Draw it on a transparent 2D canvas or DOM layer stacked above the WebGL canvas and reuse the existing UI code and layout where possible. Panels still look like old wooden or stone signboards.
- Lobby, Waiting and Game over stay DOM overlays shown above the 3D scene. The scene may be blurred behind them.
- Board clicks: cast a ray from the camera through the pointer onto the board plane to find the cell. The hover highlight is a flat glowing decal on that cell.

## G. Effects (event driven)
Effects react to events returned by src/logic and never change rules.
- Stone placed: the sprite pops in with a small bounce, sparkles, a dust puff, a light camera shake.
- Wind Dash: a pale blue swirl around the source stone, a red translucent frame decal on the target cell, and when it resolves the stone streaks across with a trail.
- Tornado Zone: a translucent swirling column of particles over the secret cross of 5 plots (docs/design.md section 5.1). Thrown stones fly in an arc and land with a dust puff.
- Mud Trap: a bubbling mud puddle on the plot; a stone planted in it sinks into the ground and comes back up when it surfaces.
- Petrification: the enemy stone is wrapped in energy, turns grey and shatters into a rock with dust and a light camera shake. The rock stays for good.
- Skill banner text is HUD text. Wind streaks always drift.
- No sound in version 2.

## H. Assets and fallbacks
- assets/manifest.json lists every texture and sprite sheet with its size and frame data. A missing file is replaced by a generated placeholder (coloured shape or letter) so the game always runs.
- Real art is added by replacing files. docs/art-spec.md (a task creates it) lists every file, size and frame count for the art generator.
- AI generated art must be cleaned to a true pixel grid and a limited palette. Generated images use magenta (#FF00FF) as the transparency key.

## I. Files
- Vendored libraries live in vendor/ (see AGENTS.md). 3D code lives in src/render3d/. The old 2D renderer in src/render/ stays working until the 3D game is finished, and is reachable with ?render=2d.

## J. Config values to add (src/config.js)
CAMERA_FOV, CAMERA_PITCH_DEG, CAMERA_DISTANCE, CELL_SIZE, PX_WORLD, QUALITY_DEFAULT, RENDER_SCALE, TARGET_FRAME_MS, PIECE_SPRITE_PX, CHARACTER_SPRITE_PX. Keep CELL_PX and the INTERNAL_* values for the 2D fallback.
