# Gomoku Tales

A two-player, turn-based Gomoku (five in a row) browser game with character skills.
See [docs/design.md](docs/design.md) for the full design.

Plain HTML, CSS and JavaScript (ES modules). There's no build step and nothing to install.
Node is only needed to run the tests.

## Run the game

Start a local static server from the project root:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser. You need the server because ES modules
don't load from `file://` URLs.

### Local dev mode

Open http://localhost:8000/?local=1 to play both sides in one window. Click a cell to
place a stone for whoever is to move, and press R to restart.

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

- `index.html`: page with the 960x540 game canvas
- `src/main.js`: entry point
- `src/config.js`: all tunable values (board size, cooldowns, timings, sizes)
- `src/logic/`: pure game rules (no DOM, runs under Node)
- `src/net/`: transport and room sync
- `src/render/`: canvas drawing and effects
- `src/ui/`: screens and input
- `assets/`: images and manifest
- `tests/`: unit tests
- `docs/`: design spec
