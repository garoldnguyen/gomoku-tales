# Gomoku Tales

A two-player browser game. Read docs/design.md before every task. It is the source of truth for rules, UI and art.

## Rules for every task
- Plain HTML, CSS and JavaScript using ES modules. No framework, no bundler and no build step for the game. Libraries are allowed. Browser code uses only local copies of a library in vendor/<name>/ with the exact version in vendor/VERSION.txt and its licence file kept; no CDN links and no remote URLs at runtime. Server code (worker/) may use npm packages and its own tooling (for example wrangler, run from the owner's machine to deploy); it is not needed to play locally. The game may call only its own server, never other outside services. Tests run with node --test.
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
- Three.js is allowed, but only as local files in vendor/ with a pinned version. Keep the licence file and write the exact version in vendor/VERSION.txt. Load it with an import map in index.html that points at vendor/ paths. No CDN links and no remote URLs at runtime. Npm packages are used only on the server side (worker/), never loaded by the browser. No bundler and no build step for the game. Everything must run from python3 -m http.server 8000 with no internet.
- 3D code lives in src/render3d/. Do not change src/logic or src/net for rendering reasons.
- Keep the old 2D renderer working until a task says otherwise. It is reachable with ?render=2d.
- Keep pure helpers (picking math, camera math, frame timing, quality selection) free of Three.js imports so they run under node --test.
- Pixels must stay crisp: NearestFilter textures, no mipmaps, no sub-pixel jitter.
- Performance matters. Target 60 fps on integrated graphics. Every heavy effect needs a quality switch.
- Tests cannot judge how the scene looks. In your summary, say which URL a human should open and what to look at.

<!-- GOMOKU-V3-FARMLAND -->
## FARMLAND ART UPDATE (v3), overrides older art rules

Read `docs/art-direction-v3.md` before any work in `src/render3d` or `src/ui`. It replaces the wood board, the wood HUD panels, and the old sky, cloud and wind rules from `docs/art-direction-hd2d.md`. Game rules, networking and cell numbering do not change.

1. The board is a farm field of 15 by 15 tilled plots, never wood. A move is a seed; the X or O is the plant that grows from it (stages Drop, Land, Sprout, Open, Rest, 1.2 seconds in total).
2. The shape rule: the shape belongs to the side, the colour belongs to the character. X is always a four-petal cross bloom and O is always a round bloom, whichever character plays it. The marks of a side (its plants and last-move ring, and for the player to move the hover ring and the selection decal) take the mark colour of the character that plays it (`CHARACTER_LOOK` in `src/render3d/character-look.js`: Wind Rabbit blue, Earth Bear ochre red, Jade Serpent jade green), and its seeds play that character's placement effect. Colour never carries the team alone.
3. Quality levels come from ONE table in `src/render3d/quality.js` (section 5 of the doc). No other code tests the level name. Each level only adds to the one below it.
4. The HUD is a DOM overlay of quiet glass cards (`docs/reference/v3/hud.css`), not a canvas. Text is English and uses the exact strings in section 8.
5. One wind and one sun: everything moves from the upper left toward the lower right, shadows fall toward the lower right. No straight streak lines, no outlined clouds, no wood except the curb and fence.
6. All art is vendored under `assets/` (sprites in `assets/3d/v3/`, tuning data in `assets/v3-meta.json`, font in `assets/fonts/`). Missing or wrong-size assets only warn, never crash. No new libraries or network requests for art.
7. Pure helpers get unit tests. All existing tests must keep passing. Do not allocate per frame in the render loop.

## File map (Farmland v3)

Entry points: `index.html` (the game, import map for `vendor/three`) loads `src/main.js`; `hd2d-lab.html` loads the look lab `src/render3d/lab.js`.

- `src/config.js`: every tunable value (board, cooldowns, timings, sizes, sway, shadows, bloom).
- `src/logic/`: pure game rules (`board.js`, `game.js`, `skills.js`, `characters.js`, `seats.js` (the two seats of the character select: pick, Ready, sides by pick order), `wind-rabbit-skills.js` (Wind Dash with its range, the secret cross Tornado trap and its throw), `earth-bear-skills.js` (Mud Trap, the sunk seeds, Petrification), `jade-serpent-skills.js` (Hiss lock, the Venom poison zone), `cloud.js` (Sky Watch, the 4 by 4 Cloud and `maskForViewer` / `maskEventsForViewer`, the ONE masking path), `scoring-board.js` (pure `scoringBoard` and `isSunk`: the board the lines see, with every seed sunk in mud as `SUNK`; every win check, the draw check and Sky Watch read it). Free Action (`docs/free-action-design.md`): `useSkill` never ends a turn, only `placeStone` does. No DOM, no rendering.
- `src/net/`: rooms over BroadcastChannel or the relay (`transport.js`, `ws-transport.js`, `room.js`, `spectator-room.js` (Watch a match: a listen-only room whose only message is chat), `room-code.js`, `chat.js` (player names and chat messages, shared with the relay), `audience.js` (who watches: watch, unwatch and the relay's audience), `presence.js`, `clock.js`, `fake-transport.js` for tests). `phase.js` holds the host-owned room phases (waiting, starting, playing, over). Messages added by the flow (docs/flow-design.md section 5): `pick` and `ready` (guest to host, the character select), `seats` (host to guest, the seats of `src/logic/seats.js` after every change), `start` (host to guest when both seats are Ready, with the round and the game of the pick order), `rematch` (with the round of the ended game), `rematch-status` (host and guest flags) and `new-game` (the next round and the fresh state from `newGame` in `src/logic/game.js`).
- `src/ui/`: screen flow and input: `flow.js` (pure `flowReducer`, the ONE place that picks the screen: menu, lobby, waiting, starting, game, gameover; the page names it in `data-screen` on the body), `strings.js` (all menu, lobby, room and game over text), `app.js` (the app: rooms, local game, rematch), the menu files `menu.js` (pure `menuViewModel`), `menu-dom.js` + `menu.css` (menu, How to Play, Settings), `room-screens.js` (pure lobby and waiting room view models), `game-over.js` (pure game over card and `rematchViewModel`), `screens.js` + `screens.css` + `room.css` (the lobby, waiting room and game over DOM), `new-game-watch.js`, `shot-mode.js`, `input.js` (`isTypingTarget`, `createTouchConfirm`: tap to preview, tap again to plant), `announce.js` + `announce.css` (the turn banner and the once-only first-game hints, docs/flow-design.md section 3.10), `motion.js` (`createFader`: screens and panels fade out before they hide, section 3.11), `player-names.js` (the saved name and the random Adjective Animal names), `chat-dom.js` + `chat.css` (the room chat panel, its new message popup and the watchers button, sections 3.9 and 3.12), `leave-match.js` + `leave-match.css` (Leave match on the game screen, section 3.13), `targeting.js`, `local-game.js`, `online-game.js`, `spectator-game.js` (the watched game, every input ignored), `skill-info.js` (the ONE `SKILL_INFO` table of skill texts), and the glass HUD: `hud-view.js` (pure `hudViewModel`), `cast-view.js` (pure: the card flash of a used skill, the Hiss wave and lock rune, the trap notice, the plant-now banner), `hud-layout.js` (pure card placement), `hud.js` (renders the view model into the DOM) and `hud.css` (the quiet glass styles from `docs/reference/v3/hud.css`).
- `src/render/`: the old 2D canvas renderer, kept for `?render=2d` (`game-renderer.js`, `layout.js`, `effects.js`), and the asset loader `assets.js` shared by both renderers (`USES_3D`: the 3D game loads only `3d` and `hud` art).
- `src/render3d/`, the 3D farm (Three.js only in the scene modules):
  - Quality: `quality.js` holds the ONE quality table (low, medium, high) and the URL debug switches (`?shadows=off`, `?bloom=off`, `?dof=off`, `?wind=off`, `?rays=off`, `?ripples=off`, `?fx=off`); `fps.js` the FPS meter (`?fps=1`).
  - Art: `art-assets.js` (manifest names in `ART`, sizes, placeholders), `art.js` (loaded file or placeholder), `v3-meta.js` (reads `assets/v3-meta.json`: anchors, growth stage times, flower looks), `v3-placeholder-art.js`, `placeholder-art.js` (rabbit and bear stand-ins), `pixel-art.js`, `seeded-random.js`.
  - Scene: `world.js` (renderer, camera, lights, board, hover), `world-renderer.js` (the game renderer used by `main.js`), `farm-field.js` + `farm-layout.js` (plots, curb, fence, path), `breeze-hill.js` (assembles the surroundings), `meadow.js` (pure `planMeadow`: flower drifts, trees, bushes, kept off the field) + `meadow-scene.js`, `horizon.js`, `terrain.js`, `framing.js`, `camera.js`, `sky.js` + `sky-scene.js` (gradient, painted clouds, wisps, rays, petals), `haze.js` (pure horizon haze: `HAZE_COLOR`, sky stops, depth constants, fog, floor shade, ridge crests) + `ridges-scene.js` (the two soft ridges, a screen layer), `petals.js`, `wind.js` (wind and sway math), `cloud-shadows.js`, `shadow-math.js`, `post-processing.js` (depth of field, bloom, grade), `depth-of-field.js`, `screen-grade.js`, `view-size.js`, `frame-gap.js`.
  - Forest (v3.1 section 6, Medium and High): `forest.js` (pure `planForest`, seed 20261002, and `skipForestZone`, the meadow filter), `forest-meta.js` (reads `assets/forest-meta.json`), `forest-scene.js` (one instanced mesh per sheet, rebuilt on a quality switch, the old one disposed).
  - Plants and effects: `growth.js` (pure `growthStage` timing), `plant-frames.js` (pure `plantFrames`: the in-between growth frames, `plantInBetween` of the quality table), `sprites.js` + `sprite-frames.js`, `board-marks.js`, `effect-plans.js` (pure) + `effects3d.js`, `skill-rings.js` (pure: the ring waves of the skill effects), `particle-pool.js`, `picking.js` + `hit-test.js`. Free Action effects: `skill-plans.js` (pure: the particle plans of Mud Trap, Petrification, the Tornado storm and Venom), `mud-effects.js` + `mud-art.js` + `mud-dry-art.js` (the puddle, the sinking and surfacing seed, the dried crust; the puddle and the sunk seed are drawn from the viewer's state), `stone-grey.js` (pure: the stone grey of a petrified plant), `poison-view.js` (pure: the zone plots one viewer may see) + `poison-effects.js` + `poison-art.js` (Venom sap, the wilting plant, fog, bubbles, the withered plot), `cloud-overlay.js` (pure: the cloud looks for one viewer). Character look: `character-look.js` (pure `CHARACTER_LOOK`, `sideColour`, `seatColour`, `paletteSwap`, `placementPlan`), `mark-tints.js` (the marks tinted per match), `placement-runs.js` (pure: each placement step plays once, the vine dots).
  - World characters: `characters3d.js` + `character-poses.js` (off while `SHOW_WORLD_CHARACTERS` is false; kept).
- `assets/`: `manifest.json` (every art file by name), `v3-meta.json`, the v3 pack in `assets/3d/v3/`, the character sheets in `assets/3d/`, skill icons and 2D panels in `assets/`, the DM Sans font in `assets/fonts/`.
- `tests/*.test.js`: `node --test` (`tests/skill-turn.js` is a helper, not a test: use a skill, then plant). `docs/`: design, art direction (`art-direction-v3.md` is current), art spec, testing, lab, `visual-qa.md` (the owner's checklist), `flow-design.md` and `flow-qa.md` (the flow checklist), `free-action-design.md` (the detailed record of the Free Action rework; the final rules are in `design.md`).
- `tools/`: `shots.sh` + `shots.py` (screenshot self-check, docs/shots.md; `bash tools/shots.sh flow`) and `flow_e2e.py` (`bash tools/shots.sh e2e`: two pages walk the real flow, results in `shots/e2e.json`).

<!-- GOMOKU-V31-FOREST -->
## FOREST, HORIZON, FULL WINDOW, COLLAPSIBLE HUD AND SCREENSHOT SELF-CHECK (v3.1), adds to the farmland art rules

Read `docs/art-direction-v3-1.md` before any work in `src/render3d` or `src/ui`. It changes only what it lists from `docs/art-direction-v3.md`; where the two differ, v3.1 wins. Game rules, networking and cell numbering do not change.

1. The canvas fills the whole window. Only `fitView(aspect)` in `framing.js` changes the field of view, and only for windows narrower than 16:9. A Fullscreen button (browser Fullscreen API, key F) is the only extra window control: there is no aspect ratio setting.
2. Far things fade into `HAZE_COLOR` through the functions in `haze.js`. Haze never uses blur. The sky is a plain gradient with no dithering.
3. The forest (`planForest`) exists on Medium and High only. Trees and wall strips are always scale 1. Low stays plain: only the sky gradient and the soft ground edge.
4. HUD cards are collapsible. Skill text comes only from the `SKILL_INFO` table, and numbers in it come from the game config constants.
5. Every number of the doc that code uses lives in one named constant, shared by code and tests. Pure helpers get unit tests. No per frame allocation. All existing tests keep passing.
6. The builder can see the game. Read `docs/shots.md`. After a change that affects what is drawn, run `bash tools/shots.sh --set <name>` as the task says, read `shots/report.json` first and fix every problem it lists, then open at most 3 of the PNG files with the image reading tool and compare them with the picture the task names. Write a paragraph that starts with `Seen:` in the final summary: what the pictures show in plain words, with the key numbers from the report. Write only what you saw. At most 3 rounds of fix and shoot, then stop and say what is still wrong. If the tool cannot run, say so and do not claim a visual check.
7. The pictures come from software rendering. They show layout, colour, shapes, density and overlaps, not frame rate. Never state an FPS number: the owner measures it. The reviewer may not see pictures, so quote the report numbers in the summary.
<!-- /GOMOKU-V31-FOREST -->

<!-- GOMOKU-FLOW-V1 -->
## Flow rules (menu, waiting room, rematch)
Source of truth: docs/flow-design.md.
1. Which screen is shown is decided only by src/ui/flow.js (flowReducer). No screen switches itself with its own timer or flag.
2. The host owns the room: the start after the join delay, the rematch, the round number and the phases. The guest follows messages and never changes phase on its own.
3. All text of the menu, How to Play, Settings, lobby, waiting room and game over screens lives in src/ui/strings.js (English). Numbers inside text come from src/config.js or SKILL_INFO and are never typed twice.
4. Global key shortcuts must ignore typing targets (isTypingTarget in src/ui/input.js). Room code letters include C, F, Z, H and V.
5. Every new screen gets a shot scene, data-hud-box names and a Seen: paragraph (see docs/shots.md and the screenshot rule in this file).
6. Menus and room screens use the Ivory look (docs/flow-design.md section 3.0): new CSS uses the Ivory palette tokens only (the #screens block of src/ui/screens.css); the in-game HUD keeps its glass tokens (plus the Ivory accents of section 3.10: Jost throughout, spaced gold capital labels, a pale gold hairline). The one UI typeface is Jost (src/ui/ivory.css). No hex colours outside a token block. Motion follows section 3.11: only opacity and transforms animate, exits are shorter than entrances, and everything stops under prefers-reduced-motion.
<!-- /GOMOKU-FLOW-V1 -->
