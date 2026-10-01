# Gomoku Tales

A two-player browser game. Read docs/design.md before every task. It is the source of truth for rules, UI and art.

## Rules for every task
- Plain HTML, CSS and JavaScript using ES modules. No framework, no bundler, no build step, no network calls to outside services. Do not add npm dependencies unless the task says so.
- Game rules live in pure modules under src/logic/ with no DOM or browser APIs, so they run under Node and can be unit tested.
- Rendering lives in src/render/, screens and input in src/ui/, networking in src/net/, art files in assets/.
- Tests use the Node built-in test runner. Run them with: node --test
  Test files are named tests/*.test.js. Add or update tests for every rule you touch. Do not finish a task with failing tests.
- Serve the game locally with: python3 -m http.server 8000 and open http://localhost:8000
- Keep tunable values (board size, cooldowns, rock lifetime, cell size, timings) in src/config.js.
- Do only the current task. Do not start later tasks.
- Never add secrets, API keys or .env files.
- All in-game text is English.
- If the task and docs/design.md disagree, follow the task and mention the conflict in your summary.

## HD-2D RENDERING UPDATE (overrides the rules above where they disagree)
- The game now uses a 3D scene (Three.js) with 2D pixel sprites. Read docs/art-direction-hd2d.md before every rendering task. It replaces the rendering and art parts of docs/design.md.
- Three.js is allowed, but only as local files in vendor/ with a pinned version. Keep the licence file and write the exact version in vendor/VERSION.txt. Load it with an import map in index.html that points at vendor/ paths. No CDN links, no remote URLs at runtime, no npm packages, no bundler, no build step. Everything must run from python3 -m http.server 8000 with no internet.
- 3D code lives in src/render3d/. Do not change src/logic or src/net for rendering reasons.
- Keep the old 2D renderer working until a task says otherwise. It is reachable with ?render=2d.
- Keep pure helpers (picking math, camera math, frame timing, quality selection) free of Three.js imports so they run under node --test.
- Pixels must stay crisp: NearestFilter textures, no mipmaps, no sub-pixel jitter.
- Performance matters. Target 60 fps on integrated graphics. Every heavy effect needs a quality switch.
- Tests cannot judge how the scene looks. In your summary, say which URL a human should open and what to look at.
