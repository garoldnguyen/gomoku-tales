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

### Play online (two windows)

In version 1 a room links two windows of the same browser profile (a BroadcastChannel),
so open http://localhost:8000 in two windows of the same Chrome profile and keep both
visible (hidden tabs slow their timers, which can start a false leave countdown).

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

### Local dev mode

Open http://localhost:8000/?local=1 to play both sides in one window. Click a cell to
place a stone for whoever is to move, and press R to restart.

To use a skill, click its button on the mover's panel (Wind Rabbit on the left, Earth
Bear on the right), then click its target on the board. The status line tells you what
to pick. Press Esc, right click, or click the same button again to cancel.

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
- `src/ui/`: screens (lobby, room, game over) and input
- `assets/`: images and manifest
- `tests/`: unit tests
- `docs/`: design spec
