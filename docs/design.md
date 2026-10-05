# Gomoku Tales: Design Spec (v1)

Source of truth for all tasks.

## 1. Overview
Gomoku Tales is a two-player, turn-based Gomoku (five in a row) game for the browser with cute 16-bit pixel art. Each player is a character with two skills that bend the normal rules. Version 1 has one map: Windy Spring Breeze Hill.

Players meet in an online room made with a room code. In version 1 the online connection works between two browser windows on the same computer and the same Chrome profile. Real play across two computers comes later.

## 2. Tech and architecture
- Plain HTML, CSS and JavaScript (ES modules). No framework, bundler or build step. Node is used only to run unit tests (node --test).
- Canvas 2D at a fixed internal resolution of 960x540, scaled to fit the window, with pixelated scaling (image-rendering: pixelated). Screens that are easier as HTML (lobby, room code input) may use DOM overlays (in the Farmland v3 quiet glass look, src/ui/screens.css).
- Folders: src/logic (pure rules), src/net (transport and room sync), src/render (the old 2D canvas renderer, kept for ?render=2d, and the shared asset loader), src/render3d (the 3D farm, the default renderer), src/ui (screens, input and the glass HUD), assets/ (images, manifest and tuning data), tests/, docs/.
- Rendering and art now follow docs/art-direction-v3.md (Farmland v3), which replaces sections 3.1, 7 and 8 of this file for the 3D game; those sections still describe the 2D fallback renderer (?render=2d). The v3 modules:
  - src/render3d/quality.js: the ONE quality table (low, medium, high, art direction v3 section 5), the pure level picking, saving and automatic step down, and the URL debug switches (?shadows=off, ?bloom=off, ?dof=off, ?wind=off, ?rays=off, ?ripples=off, ?fx=off). No other code tests a level name.
  - src/render3d/v3-meta.js: reads assets/v3-meta.json, the tuning data of the v3 art pack (sprite anchors, plant growth stage times, flower looks, wind bit kinds), with defaults when the file is missing or bad.
  - src/render3d/meadow.js: planMeadow(seed), the pure seeded plan of the meadow (flower drifts of one kind, grass tufts, clover, trees, bushes and hay bales), kept off the field, curb, fence and path; meadow-scene.js draws it with one instanced mesh per kind.
  - src/ui/hud.css with src/ui/hud.js, hud-view.js (pure hudViewModel) and hud-layout.js: the HUD as a DOM overlay of quiet glass cards over the 3D world, instead of the canvas panels. The lobby and room screens (src/ui/screens.css) use the same glass look.
  - Collapsible HUD cards (docs/art-direction-v3-1.md section 4): each card has a 44 px chevron button and folds into a pill; the choice is saved per team (gomoku.hud.collapsed.x and .o). Keyboard: the C key collapses or expands both cards (C was free: the other game keys are R restart, Q quality and Esc cancel; C is ignored with Ctrl, Cmd, Alt or Shift, on key repeat, while typing in a text field, and where the cards cannot fold: the slim bar layouts of narrow windows and the smallest full-card windows, where a pill with 44 px buttons and chevron would reach over the board; there the chevron hides and the saved choice is kept). Skill descriptions come from the one SKILL_INFO table in src/ui/skill-info.js, shown under each skill row and in the shared tooltip (src/ui/tooltip-position.js places it).
  - Fullscreen button (docs/art-direction-v3-1.md section 3.5, src/ui/fullscreen.js): a 44 px glass button in the top bar left of the quality switch (under it on narrow phones, topBarLayout in hud-layout.js) with an expand or collapse icon, the aria-label Enter full screen or Exit full screen and aria-pressed. It puts the whole page in full screen with the browser Fullscreen API and follows the fullscreenchange event, so Escape and F11 keep the label right. It is not shown when the browser has no Fullscreen API (iPhone Safari). Keyboard: the F key toggles it (F was free: the other game keys are R restart, Q quality, C HUD cards and Esc cancel; F is ignored with Ctrl, Cmd, Alt or Shift, on key repeat and while typing in a text field). There is no aspect ratio setting: the view is always Auto.
  - The full file map is in AGENTS.md and CLAUDE.md.
- src/config.js holds all tunable values (section 10).
- Game state is one plain, serializable object. Logic functions take a state and an action and return a new state plus a list of events (stone placed, skill announced, stone thrown, rock broken, and so on). Rendering and effects react to events. The logic never draws.
- Randomness (Tornado Zone) is decided only by the host and sent to the other player inside the resulting state or event. It never runs separately in both windows. In tests the random function is injected.

## 3. Screens
Which screen is shown is decided only by the flow reducer in src/ui/flow.js (screens menu, lobby, waiting, starting, game, gameover; docs/flow-design.md section 4). The page names the current one in the data-screen attribute of the body. Every screen is a quiet glass DOM layer over the 3D farm, and all its text lives in src/ui/strings.js.
1. Menu (the first screen): Play Online, Play on this computer, How to Play and Settings, in one column over the empty farm. Play on this computer opens the local game (both players in one window, the same as ?local=1, which skips the menu) on the character select of Player 1 and Player 2: each picks a character (one picked in one seat is disabled for the other) and presses Ready; the first pick plays X and moves first, and the game starts when both are Ready. How to Play shows the six rules lines and the four skills from SKILL_INFO, with the numbers read from src/config.js. Settings switches the graphics quality (Low, Medium, High) at once without a reload and has a Fullscreen button. Escape or Close closes both panels.
2. Lobby: Create Room (the room is made at once with a new code and two empty seats; no character is chosen here), Join Room (a code box) and Back to the menu. A hint says online play works between two windows of this browser. The code box keeps only code characters in upper case (spaces, dashes, 0, O, 1 and I vanish), Join is enabled at 5 characters, and errors (room not found, room full, host left) show inline under the box, never as a pop-up. Room code letters such as C, F, Z, H and V never trigger a key shortcut while typing.
3. Room, phase waiting: the title Waiting for opponent, the room code (large, with Copy), the two seats (the host's left, the guest's right, the own one tagged You, the empty guest seat a dimmed Waiting placeholder) and Leave, which closes the room and returns to the menu. The host may already pick a character and press Ready.
4. Room, phase starting (the character select, docs/flow-design.md section 3.5): once the second player joined, both windows show the title Pick your character and both seats. Each player picks a character for their own seat (a character taken by the other seat is disabled) and presses Ready; the first pick plays X and moves first. There is no request button and no timer: when both are Ready the host sends start and both enter the game at the same moment. Leave stays enabled. If the guest leaves now its seat is empty again and the host waits; if the host leaves the guest returns to the lobby with the host left notice.
5. Game: the board in the centre and a HUD card per player (section 3.1). The game is round 1 of the room; every rematch is the next round.
6. Game over: a compact card at the top centre, so the finished board stays visible. Headline You win or You lose with the winning character (online), the winning character plus wins (local), Draw with The board is full, or You win with Opponent left after a forfeit. Two buttons: Rematch and Back to Menu (always enabled; online it leaves the room). Online, Rematch needs both players: the first press shows Waiting for opponent and Your request was sent, the other window shows Opponent wants a rematch, and when both pressed the host starts a clean board with the same characters on the same sides, X (the first pick) first. After the opponent left, Rematch is disabled with Opponent left. Local, Rematch starts the new game at once.

### 3.1 Game screen layout (960x540)
- Board: 15x15 wooden grid, 24 px cells (360x360 px), centred.
- Left panel: Wind Rabbit. Right panel: Earth Bear. Each panel looks like an old wooden or stone signboard and shows: character portrait, name, stone type (X or O), a highlight when it is that player's turn, and the two skill buttons. A skill button shows its icon, name, remaining cooldown, and a grey overlay while locked. The local player's panel has a "You" tag.
- Status line under the board for messages (Your turn, Opponent's turn, Choose a target, Opponent left, You win in 10, and so on).
- The Map 1 scene is drawn behind everything (section 7).

## 4. Core rules
- Board 15x15. Wind Rabbit uses X stones and always moves first. Earth Bear uses O stones. The room creator picks which character they play; the joiner gets the other one.
- On your turn you do exactly one thing: place a stone on an empty cell, or use an available skill. Using a skill uses your whole turn.
- A cell is empty if it holds no stone and no rock.
- Win: five or more stones of your colour in an unbroken horizontal, vertical or diagonal line. Check for a win for the acting player after every placement and after every skill effect that changes stones (Wind Dash landing, Tornado throw, Stone Conversion). Rocks count for neither colour and break lines.
- If the board is full and nobody has won, it is a draw.

## 5. Characters and skills
There are three characters: Wind Rabbit, Earth Bear and Jade Serpent. Each owns two skills. A character has no fixed stone colour: the side is decided by pick order. The player who picks first plays X (blue) and moves first; the player who picks second plays O (red). Both players cannot pick the same character. (assignSides(pickOrder) in src/logic/characters.js; until the character select exists, the two character lobby uses Wind Rabbit as X and Earth Bear as O.) The X and O shapes and team colours belong to the side, not to the character.

Cooldown rule: after you use a skill you cannot use it during your next N turns (short cooldown N = 3, long cooldown N = 6). Cooldowns count your own turns only.

### 5.1 Wind Rabbit
Look: a cute white pixel rabbit with a scarf fluttering in the wind.

WIND DASH (short cooldown). Uses your turn.
- Choose one of your own stones and one empty target cell. The dash is announced: the opponent sees a red, translucent frame on the target cell and a swirl around the source stone.
- The opponent then takes their next turn as normal. When that turn ends, the dash resolves.
- On resolve: if the source cell still holds one of your stones and the target cell is still empty, the stone moves to the target (the source becomes empty) and then the win check runs. Otherwise the dash fails, the stone stays where it is, and the cooldown still applies.
- If the opponent wins on their turn, the game ends and the dash never resolves.
- Visual: a wiggly wind icon. When chosen, the stone is wrapped in a pale blue whirl and the target cell gets the red translucent frame.

TORNADO ZONE (long cooldown). Uses your turn.
- Choose the centre of a 3x3 zone. The zone is clipped by the board edges. A swirling wind overlay covers the zone.
- The zone lasts through the opponent's next turn only. If the opponent places a stone inside the zone on that turn, then after placing it the stone is thrown to a random empty cell among the (up to 8) cells next to where it was placed. A cell is not valid if it holds a stone or a rock or is off the board. If no neighbouring cell is valid, the stone stays. A thrown stone is never thrown again. Then the win check runs. The host picks the random cell.
- The zone disappears at the end of the opponent's turn. It does not affect Wind Dash landings, rocks or Stone Conversion.
- Visual: a whirlwind icon tossing small stones, and a translucent whirlwind over the 3x3 area.

### 5.2 Earth Bear
Look: a chubby brown pixel bear wearing a miner's jacket or a badge with an earth or rock symbol.

TERRAIN CREATION (short cooldown). Uses your turn.
- Choose any empty cell. A rock falls onto it immediately.
- A rock blocks its cell for both players: nobody can place, dash or throw a stone onto it, and it cannot be converted.
- A rock breaks after 2 rounds. Precisely: it lasts for the 4 turns that follow the turn in which it was created (2 turns of each player) and disappears at the end of the 4th of those turns, leaving an empty cell. (ROCK_LIFETIME_TURNS = 4 in config.)
- Visual: a square rock icon. A real rock sprite drops onto the cell with a small bounce, dust and a light screen shake. When it breaks it crumbles.

STONE CONVERSION (long cooldown). Uses your turn.
- Choose one opponent stone on the board. It becomes one of your stones at once, then the win check runs for you.
- Visual: an icon with an arrow from an opponent stone to your stone with light rays. The chosen stone glows brightly and flips into your stone look.
- If the converted stone was the source of a pending Wind Dash, that dash fails when it resolves (see 5.1).

### 5.3 Jade Serpent
Look: a slim jade green pixel serpent with a leaf on its head.

HISS (short cooldown, COOLDOWN_SHORT). Uses your turn. No target.
- On the opponent's next turn they cannot use any skill. They can still place a stone.
- The lock ends at the end of that turn. It is not a cooldown: the opponent's cooldowns do not change.
- If the game ends on that turn, the lock is dropped.

VENOM (long cooldown, COOLDOWN_LONG). Uses your turn.
- Choose one opponent stone (plant) on the board. It is removed at once and its cell is left empty.
- The target must be an opponent stone. An empty cell, a rock, your own stone or a cell off the board is rejected like the other skills: nothing happens, the turn and the cooldown are not used.
- If the removed stone was the source of a pending Wind Dash, that dash fails when it resolves (see 5.1).

## 6. Online rooms (version 1)
- Room code: 5 characters, uppercase letters and digits, leaving out easily confused characters (no 0, O, 1, I).
- Transport interface in src/net/transport.js with send(message), onMessage(handler) and close(). Two implementations, picked by ONLINE_TRANSPORT in src/config.js through chooseTransport(config); src/ui/app.js builds every room with it (transportOpener) and src/net/room.js does not know which one it has:
  - broadcast: a BroadcastChannel named "gomoku-tales-" plus the room code, so two windows of the same origin and browser profile can play.
  - websocket (src/net/ws-transport.js): a WebSocket to the relay server (worker/, docs/deploy.md) at RELAY_PATH on the page's own host, with the room code and the role (host or guest) in the URL. It also has an opened promise. The host enters its room only once its connection is open (the lobby's Create reads Connecting meanwhile); if it cannot open, the host stays on the lobby with the connection error from strings.js. The guest sends "join" only once its connection is open; when the relay refuses it (no host for that code, or the room is taken) it shows No room found at once instead of waiting JOIN_TIMEOUT_MS. onClose(handler) reports a connection lost after it opened: a pending join then shows the connection error on Join Room, and the waiting room (host or seated guest), a game in play or the game over card goes to the lobby with it (the relay has forgotten that room). A game in play is not left to the presence countdown, which would tell the disconnected window that its opponent left and it won.
  - The same-browser rule has one source: onlineSameBrowserOnly(config) in src/net/transport.js is true only for broadcast. Only then does the lobby show the same-browser hint line, and the waiting room hint names a second window of this browser (for the relay it says to send the code to the opponent).
  - Local test switch: on a page served from localhost, 127.0.0.1 or ::1, the URL parameter transport=broadcast or transport=websocket overrides ONLINE_TRANSPORT (chooseTransport(config, { search, hostname }), the second argument defaults to the browser location). On any other host, or for any other value, it is ignored. Open http://localhost:8787/?transport=websocket with wrangler dev to play through the local relay (docs/deploy.md, Local test). The same-browser rule follows the chosen transport.
  - Also an in-memory fake transport for tests.
- Host-authoritative: the window that created the room is the host. It checks every action, applies it to the game state, makes the random choices, and broadcasts the new state and events. The joiner only sends action requests and draws what the host sends. Invalid actions are rejected with a message.
- Join handshake: the joiner sends "join". The host answers "welcome" with the seats of the character select (and the state once the game started), but only while its room is in phase waiting; in any other phase it answers "full". No answer within JOIN_TIMEOUT_MS means the room was not found.
- Phases (src/net/phase.js), owned by the host: waiting (no guest), starting (a guest joined; both pick a character and press Ready, the guest through "pick" and "ready" messages that the host checks and answers with "seats"), playing (after the host's "start" message with the round and the game of the pick order, sent when both seats are Ready, which the guest follows and never times itself) and over (the game ended). An action before playing is rejected as not started.
- Rematch and round: the round is 1 for the first game of a room and grows by one with every rematch; a message with another round is ignored. In phase over each player may send "rematch"; the host answers every change with "rematch-status" (host and guest flags) and, when both asked, sends "new-game" with the next round and the fresh state (newGame in src/logic/game.js: empty board, no rocks, cooldowns 0, the same characters on the same sides, X to move). No rematch after a forfeit.
- Heartbeat: each side sends a ping every 1 second in every phase. In phase playing, if nothing has arrived from the other side for 3 seconds, or a "leave" message arrives (sent when the page closes), start a 10 second countdown shown on screen (for example "Opponent left. You win in 10"). If messages resume, cancel the countdown. At 0, announce that the opponent left and that the remaining player wins, then show the game over screen. In phase starting a missing peer sends the host back to waiting (the guest seat empty again) and the guest back to the lobby; in phase over there is no countdown, the game over card only shows Opponent left.
- Known limit: browsers may slow timers in hidden tabs, which can cause false countdowns. Keep both windows visible while testing.
- Dev mode: opening the page with ?local=1 puts both sides in one window so the rules can be tested without rooms.

## 7. Art direction
For the 3D game, docs/art-direction-v3.md replaces this section (a farm field of tilled plots instead of the wooden board, X and O as growing plants, painted clouds and petals instead of wind streaks, glass HUD cards instead of signboards). This section describes the 2D fallback renderer (?render=2d).
- 16-bit pixel art, bright saturated candy colours, cute. Stones have a bold dark outline so they stand out on the wooden board.
- Map 1, Windy Spring Breeze Hill: a green grass hill with wild flowers and blossoming trees, a clear blue sky and white clouds. The 15x15 wooden grid board sits in the middle of the grass. Faint wind streaks drift across the screen all the time to stress the wind theme.
- Stones: no plain cross and no plain circle. Custom art that is unique to this map. X (Wind Rabbit, blue theme): a young twig or vine sprout piece. O (Earth Bear, red theme): a round stone flower bud piece. Both with outlines.
- Characters: Wind Rabbit and Earth Bear as described in section 5, as portraits, with a small idle animation if time allows.
- Skill icons: detailed and faithful to the descriptions in section 5.
- Panels: old wooden or stone signboard frames.
- Sprite sizes: stones 24x24, rocks 24x24, skill icons 32x32, portraits 96x96, tornado overlay 72x72 (animated), background 960x540, board with its frame 372x372, panel signboards 240x372. Sizes may change if the art needs it. Update config and this file together.
- Loading: assets/manifest.json lists every asset by name. The game must run with no art files present by drawing simple placeholders (a blue disc for X, a red disc for O, letters on icons). Real art is added later by replacing files, without code changes.
- Generated art must be cleaned to a true pixel grid with a limited palette before it is added.

## 8. Effects and polish
For the 3D game see docs/art-direction-v3.md sections 4, 7 and 9 (no straight wind streaks there). This section describes the 2D fallback renderer.
- When a stone is placed, or a skill hits a stone: small sparkles, a puff of dust and a light screen shake.
- Wind streaks drift across the background at all times.
- Skill announcements appear as a short text banner (for example "Wind Dash!").
- No sound in version 1.

## 9. Out of scope for version 1
More maps, more characters, accounts or rankings, a computer opponent, play across two computers, sound and music, a phone touch layout, Vietnamese text.

## 10. Config values (src/config.js)
BOARD_SIZE = 15
WIN_LENGTH = 5 (five or more wins)
COOLDOWN_SHORT = 3
COOLDOWN_LONG = 6
ROCK_LIFETIME_TURNS = 4
TORNADO_SIZE = 3
CELL_PX = 24
INTERNAL_WIDTH = 960
INTERNAL_HEIGHT = 540
HEARTBEAT_INTERVAL_MS = 1000
PEER_TIMEOUT_MS = 3000
LEAVE_COUNTDOWN_S = 10
ROOM_CODE_LENGTH = 5
