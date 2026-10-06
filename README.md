# Gomoku Tales

A two-player, turn-based Gomoku (five in a row) browser game with character skills.
See [docs/design.md](docs/design.md) for the rules and screens, and
[docs/art-direction-hd2d.md](docs/art-direction-hd2d.md) for the look.

The game is drawn HD-2D style: cute pixel art sprites standing in a small 3D scene
(Windy Spring Breeze Hill) under a fixed camera, with soft light, depth of field and a
little bloom. The HUD (panels, skill buttons, status line, banners) and the lobby and room
screens stay 2D on top of it.

Plain HTML, CSS and JavaScript (ES modules). There's no build step and nothing to install.
Three.js 0.186.1 is vendored in `vendor/` (see [vendor/VERSION.txt](vendor/VERSION.txt))
and loaded through an import map, so the game runs with no internet connection. Node is
only needed to run the tests.

## Run the game

Start a local static server from the project root:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser. You need the server because ES modules
don't load from `file://` URLs. A browser with WebGL is needed for the 3D world; if WebGL
or the 3D code fails to load, the game falls back to the 2D renderer and logs a console
warning.

| URL | What it opens |
|---|---|
| http://localhost:8000 | the game: lobby and online rooms, 3D world |
| http://localhost:8000/?local=1 | local dev mode: one window plays both sides, 3D world |
| http://localhost:8000/?render=2d | the old flat 2D renderer (combine with `&local=1`) |
| http://localhost:8000/hd2d-lab.html | the HD-2D look lab: a test scene, not playable |

### Quality levels and the Q key

Each window has its own 3D quality level. Press **Q** to cycle high -> medium -> low ->
high; the level and the FPS show in the top-left corner as "Quality medium [Q]  FPS 60".
Q does nothing while you type in a text box (the room code) and nothing in the 2D renderer.
`?quality=low`, `?quality=medium` or `?quality=high` in the URL picks a level (anything
else means medium). A choice made with Q or the URL is saved in `localStorage` and used at
the next start; without a saved choice the game starts on medium. The game works when
storage is blocked. Switching never resets the game.

| Level | Pixel ratio cap | Post effects | Shadows | Sky and background | Effect particles (live cap) | Blur behind menus |
|---|---|---|---|---|---|---|
| high | 2 | bloom, depth of field, vignette (warm grade comes later) | sun shadow maps and blob shadows | clouds, wind and moving background | all (220) | yes |
| medium (default) | 1.5 | none, no blur at all | blob shadows | still clouds, no wind | about a quarter (60) | yes |
| low | 1 | none | none | plain sky, no scenery, flowers or hills | none (0) | no |

Tone mapping is on at every level. When the average frame time stays above
`TARGET_FRAME_MS` for 3 seconds, the window steps down one level by itself and the corner
shows "(auto)"; an automatic step down is not saved. This happens only while the browser
has no saved choice: once a player picks a level (Q, the HUD switch or Settings), the game
never changes it again. The level is per browser (localStorage), never sent to the other
player. Every switch lives in ONE table in
`src/render3d/quality.js` (docs/art-direction-v3.md section 5); the camera and timings are
in `src/config.js`.

### The look lab

http://localhost:8000/hd2d-lab.html shows the same 3D world with a few sample pieces, the
hover highlight and the FPS, without the game around it. Use it to judge the look and
the speed of each quality level. [docs/lab.md](docs/lab.md) says what to look at.

### The 2D renderer

Add `?render=2d` to any game URL (for example http://localhost:8000/?render=2d or
http://localhost:8000/?render=2d&local=1) to play with the original flat Canvas 2D
renderer. It has no quality levels. Both renderers draw the same game, and windows with
different renderers can play in the same room.

### Play online (two windows)

The deployed game links players on different computers through the relay server
(docs/deploy.md, `npx wrangler deploy`). Served by `python3 -m http.server` there is no
relay, so open http://localhost:8000/?transport=broadcast in two windows of the same
Chrome profile instead (a BroadcastChannel), or run `npx wrangler dev` and open
http://localhost:8787. Keep both windows visible (hidden tabs slow their timers, which
can start a false leave countdown).

1. In the first window click Create Room and pick Wind Rabbit or Earth Bear. The Waiting
   screen shows the 5 character room code; Copy puts it on the clipboard.
2. In the second window click Join Room, type or paste the code and press Join. The
   joiner gets the other character and the game starts in both windows.
3. Wind Rabbit (X) moves first. Each window can only place its own stones and use its own
   skills. The window that created the room is the host and checks every move.
4. When the game ends the Game over screen shows the result; Back to Lobby leaves the room.

If a window closes or goes quiet mid-game, the other one shows "Opponent left. You win
in 10" and counts down; at 0 it shows "Opponent left, you win!". If the opponent comes
back before 0, the countdown stops.

Each window runs its own 3D world (its own WebGL context and quality level), so both can
show the scene side by side.

[docs/testing.md](docs/testing.md) is a step-by-step manual test of all this in two
windows, including every skill and its edge cases, and the checks that only the 3D world
needs (section 10).

### Local dev mode

Open http://localhost:8000/?local=1 to play both sides in one window. Click a cell to
place a stone for whoever is to move, press R to restart and Q to change the quality.

To use a skill, click its button on the mover's panel (Wind Rabbit on the left, Earth
Bear on the right), then click its target on the board. The status line tells you what
to pick. Press Esc, right click, or click the same button again to cancel.

## Art

`assets/manifest.json` lists every texture and sprite sheet by name, with its file
(relative to `assets/`), pixel size, frame count and frame time. The game runs with no
image files: anything missing is drawn as a generated placeholder. To add real art, save
a PNG of exactly the listed size under the file name from the manifest and reload; no code
changes are needed. A file of the wrong size is refused with a console warning and the
placeholder stays. Animations are sprite sheets with all frames in one row. The 3D world's
art lives in `assets/3d/` (board top, pieces, character poses, flowers, clouds, decals);
the other entries are for the 2D renderer and the HUD.

[docs/art-spec.md](docs/art-spec.md) lists every file with its size and frames, the pixel
density and palette rules, and a prompt template for each asset.

## Run the tests

Tests use the Node built-in test runner (Node 18 or newer):

```sh
node --test
```

or the same thing through npm:

```sh
npm test
```

Test files go in `tests/` and are named `*.test.js`.

## Project layout

- `index.html`: the game page: the WebGL canvas, the 960x540 HUD canvas above it, the
  lobby and room screens, and the import map for Three.js
- `hd2d-lab.html`: the HD-2D look lab page
- `src/main.js`: entry point; picks the renderer and the mode from the URL
- `src/config.js`: all tunable values (board size, cooldowns, timings, sizes, camera,
  quality and effect settings)
- `src/logic/`: pure game rules (no DOM, runs under Node)
- `src/net/`: transport and room sync
- `src/render/`: the 2D renderer, the shared 2D HUD drawing and the asset loader
- `src/render3d/`: the 3D world (scene, sprites, effects, post-processing, quality
  levels) and the lab; pure helpers here have no Three.js imports and are unit tested
- `src/ui/`: screens (lobby, room, game over) and input
- `vendor/three/`: the vendored Three.js files and licence
- `assets/`: images and manifest
- `tests/`: unit tests
- `docs/`: design spec, HD-2D art direction, art spec, lab notes and the manual test
