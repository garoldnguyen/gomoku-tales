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
