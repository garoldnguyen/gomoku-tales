# Gomoku Tales: Flow Design (menu, waiting room, rematch)

Status: plan for the tasks "Flow v1, step 1 of 7" to "Flow v1, step 7 of 7" in .millstone/tasklist.md, changed by "Game v5, part 2 of 3" (the character select with Ready, sides by pick order, no automatic start). It extends docs/design.md section 3 (Screens) and section 6 (Online rooms). Step 7 folds the final behaviour back into those sections. All game text is English (Vietnamese is out of scope, see section 10).

Names in this file (flow.js, strings.js, newGame, start, rematch and so on) are descriptive. If the code already has a module, function or message for the same job, reuse it and keep its name.

## 1. Goals
1. A main menu is the first screen.
2. A room shows both players before the game starts; each picks a character and presses Ready.
3. The game over screen has a Rematch button. The host decides, like everything else online.
4. Every screen is testable three ways: pure view models in node tests, scenes in shot mode (docs/shots.md), and one end to end run in a real browser (step 7).

## 2. Decisions
1. Menu: four buttons. Play Online (goes to the lobby), Play on this computer (the ?local=1 mode, two players in one window), How to Play, Settings.
2. Characters are picked inside the game, never in the lobby. There are three (Wind Rabbit, Earth Bear, Jade Serpent) and two seats. Each player picks a character for their seat and presses Ready. A character picked by one seat is disabled for the other seat. The first pick plays X and moves first, the second plays O (assignSides). A seat may change its pick until it is Ready (it keeps its place in the pick order); Ready needs a pick and locks it. The game starts when both seats are Ready. There is no automatic start and no timer (WAITING_START_DELAY_MS is gone), and there is no request button.
   - Online: the host owns the start. The guest sends its pick and its Ready to the host, the host checks them with the same seat rules (src/logic/seats.js), updates the room and answers with the seats. When both seats are Ready the host sends start with round 1. The guest enters the game only on start.
   - Local (Play on this computer): the game screen opens on the character select with the seats Player 1 and Player 2, both picked in the one window; the local game starts when both are Ready.
3. Rematch needs both players to press it. Same characters, same sides, X (the first pick) moves first. Swapping sides is not part of this version.
4. A join is accepted only while the room is in phase waiting. In any other phase the answer is full.
5. Online play uses the transport of ONLINE_TRANSPORT (src/config.js, read only by chooseTransport): broadcast links windows of the same browser on the same computer (BroadcastChannel), websocket goes through the relay server (worker/) so players on different computers can meet. The UI learns which one from a single function, onlineSameBrowserOnly(config) in src/net/transport.js (true only for broadcast); there is no separate flag. Only for broadcast the lobby shows the same-browser hint line. With websocket the host's Create reads Connecting until its relay connection is open, a host that cannot connect stays on the lobby with the connection error, and a guest the relay refuses sees No room found at once. A relay connection lost after it opened closes the room: a pending join shows the connection error on Join Room, and the waiting room (host or seated guest), a game in play and the game over card go to the lobby with it (a game in play is not left to the presence countdown, which would call the disconnected window the winner).
6. Out of scope: computer opponent, Vietnamese text, sound and music, phone touch layout, accounts, more maps.

## 3. Screens
Every screen is a quiet glass DOM layer over the existing 3D world (same tokens as src/ui/hud.css and screens.css). No second WebGL renderer and no new canvas. Every screen is drawn from a pure view model so that shot mode can draw it without a network.

### 3.1 Menu
```
+--------------------------------------+
|            Gomoku Tales              |
|                                      |
|          [ Play Online ]             |
|     [ Play on this computer ]        |
|          [ How to Play ]             |
|           [ Settings ]               |
+--------------------------------------+
```
- Background: the 3D world with the empty field (the look of shot scene empty).
- Buttons are real button elements in one column, centred horizontally, in the order above. Each is at least 44 px high and 240 px wide, with at least 12 px between buttons. The whole menu fits inside 1280 by 720 without scrolling.
- The first button has focus when the menu appears. Tab follows the visual order. Enter and Space activate. The focus ring is 2 px, from the existing tokens.
- Play on this computer opens the same local game screen as ?local=1, on the character select of Player 1 and Player 2 (section 3.6). No You tag.
- ?local=1 in the URL still skips the menu. ?shot= scenes also skip it.

### 3.2 How to Play
- A glass panel at most 720 px wide and 80 percent of the viewport high. It scrolls inside itself. The Close button is 44 px. Escape closes it and focus returns to the button that opened it.
- Six rules lines, produced by a pure rulesLines(config) that reads the numbers from src/config.js. Reference wording (the builder must check each sentence against src/logic and fix the sentence, never the rules):
  1. Two players take turns. Wind Rabbit plants X and always goes first. Earth Bear plants O.
  2. On your turn do one thing: plant on an empty plot, or use a skill. A skill takes your whole turn.
  3. Five or more of your plants in an unbroken row, across, down or diagonally, win the game. (number: WIN_LENGTH)
  4. After you use a skill it rests for your next 3 turns (Wind Dash, Terrain Creation) or your next 6 turns (Tornado Zone, Stone Conversion). (numbers: COOLDOWN_SHORT, COOLDOWN_LONG)
  5. A rock blocks a plot for both players and crumbles after 4 turns. (number: ROCK_LIFETIME_TURNS)
  6. If the board fills up and nobody has five in a row, the game is a draw.
- Then the four skills grouped by character: portrait, name, stone letter, and for each skill the icon, the name, the cooldown number and the description from SKILL_INFO. Skill text is never copied; it is read from SKILL_INFO.

### 3.3 Settings
- Graphics quality: a segmented choice with one option per level of the table in src/render3d/quality.js, in table order. Names are read from the table (no other code tests a level name). One short help line per level from strings.js. Choosing a level applies at once, saves through the existing saving function and never reloads the page.
- Fullscreen: a button built on fullscreenViewModel. The row is hidden when the Fullscreen API is missing.
- A Close button (44 px). Escape closes the panel.

### 3.4 Lobby
- Create Room opens the room at once with two empty seats (no character choice in the lobby; the pick is made in the room, section 3.5). Join Room opens the code box.
- Add a Back button (event BACK, also the Escape key) that returns to the menu.
- When onlineSameBrowserOnly(config) is true (the broadcast transport), show one hint line: online play works between two windows of the same browser on this computer.
- Code box: normalizeCodeInput(raw) uppercases, removes every character that is not in the room code alphabet (spaces, dashes and the confusing 0, O, 1, I vanish) and cuts to ROOM_CODE_LENGTH. Example: "ab c-d5xyz" gives ABCD5. The Join button stays disabled until the box holds ROOM_CODE_LENGTH characters. Enter submits.
- While the answer is pending the button shows Joining and is disabled, for at most JOIN_TIMEOUT_MS. Errors appear inline under the box (never an alert), in an aria-live polite region, and clear when the player types: room not found, room full, host left.

### 3.5 Room: the character select (phases waiting and starting)
The look follows the approved design in docs/reference/v5/character-select-desktop.html and character-select-phone.html (placeholder art, the owner will replace it), drawn with the existing glass tokens only.
```
+--------------------------------------------------------------+
|                    Pick your character                       |
|                     ABCD5   [ Copy ]                         |
|      Open a second window of this browser and join.          |
|        The first to pick plays X and moves first.            |
|  +--------------+  +--------------+  +--------------+        |
|  | (cross)   GH |  | (bloom)   MB |  | (leaf)    JS |        |
|  | Wind Rabbit  |  | Earth Bear   |  | Jade Serpent |        |
|  | Wind Dash  3 |  | Terrain    3 |  | Hiss       3 |        |
|  | Tornado    6 |  | Stone Conv 6 |  | Venom      6 |        |
|  +--------------+  +--------------+  +--------------+        |
|  [ Leave ]  (X You: Wind Rabbit) (Opponent: Choosing) [Ready]|
+--------------------------------------------------------------+
```
- Three character cards (data-hud-box pick-<seat>-<character>) for this window's seat: the emblem (the blue four-petal cross for Wind Rabbit, the red round bloom for Earth Bear, the jade circle with a leaf for Jade Serpent), a seal (a small rounded square with the initials GH, MB or JS in the card colour), the name, a tagline and one row per skill with its rest turns (COOLDOWN_SHORT or COOLDOWN_LONG). The picked card has a gold outline. On phones the cards stack, the emblem on the left, and Ready spans the panel above Leave.
- Under the cards one row: Leave (or Back on this computer), the two seats, and Ready (ready-<seat>). Leave, Back and Ready are at least 44 px high.
- Two seats side by side: the host's on the left, the guest's on the right (data-hud-box card-host and card-guest). Each seat shows the stone of the pick order (X for the first pick, O for the second), its label (You or Opponent), its pick and its state (Choosing or Ready).
- The cards and Ready act for this window's own seat (data-hud-box pick-host-wind-rabbit and so on, ready-host or ready-guest). A character taken by the other seat is disabled and says Taken. Ready is disabled until the seat has a pick, and once pressed the seat's buttons are disabled.
- The lead line says: The first to pick plays X and moves first.
- Phase waiting (no guest yet): title Waiting for opponent. The host may already pick and press Ready. The guest seat is a dimmed placeholder with the text Waiting and a slow pulse (opacity 0.6 to 1 over 1.6 seconds, off when prefers-reduced-motion is set).
- Phase starting (both seated): title Pick your character. Both seats show. After this window pressed Ready the line Waiting for the other player shows until the host starts the game. When both seats are Ready the host sends start and both players enter the game at once.
- The guest's pick and Ready are only requests: the seats it shows are the host's. A pick known to be refused (a taken character) is not sent.
- Leave is enabled in both phases. It closes the transport, stops every timer and returns to the menu (event LEAVE). The other window is told by the leave message: a guest who leaves before both are Ready returns its seat to empty (no pick, not Ready, out of the pick order) and the host waits again; a host who leaves sends the guest to the lobby with the notice host-left. The code can no longer be joined after the host left.
- The room code is shown at least 40 px high with letter spacing. Copy copies the code and shows Copied for COPY_FEEDBACK_MS. If the clipboard API is missing or rejects, select the code text and show Press Ctrl+C.

### 3.6 Game
No visual change. A rematch returns to this screen with a clean board.

In local mode (Play on this computer and ?local=1) the game screen opens on the character select (data-hud-box select-panel): the same layout as section 3.5 without the code: the three character cards, the seats Player 1 and Player 2 (card-player1, card-player2), Ready, and a Back button (select-back, also Escape) that returns to the menu. The cards and Ready act for the active seat (outlined): Player 1 by default, but either seat may pick first: pressing the other seat's card (a button while that seat is not Ready) makes it the active seat. When the active seat is Ready the cards pass to the seat that is not Ready yet. A character picked in one seat is disabled for the other. The first pick plays X and moves first. The game starts when both seats are Ready; a rematch (and R) keeps the same characters on the same sides.

### 3.7 Game over
```
+--------------------------------------+
|              You win                 |
|          Wind Rabbit won             |
|   [ Rematch ]   [ Back to Menu ]     |
|   Opponent wants a rematch           |
+--------------------------------------+
```
- A compact glass card anchored at the top centre, at most 480 px wide and at most 24 percent of the viewport height at 1080 px high, so the finished board stays visible. It never overlaps a HUD card.
- Headlines: online winner "You win" with the winning character as subline; online loser "You lose"; local game: the winning character name plus "wins"; draw: "Draw" with the subline "The board is full"; forfeit: "You win" with the subline "Opponent left".
- Buttons Rematch and Back to Menu, each at least 44 px high. Back to Menu is always enabled.
- Rematch button states (pure rematchViewModel):
  - idle: label Rematch, enabled, no hint.
  - mine (I pressed): label Waiting for opponent, disabled, hint "Your request was sent".
  - theirs (the other pressed): label Rematch, enabled, hint "Opponent wants a rematch".
  - gone (the other left, or the game ended by forfeit): label Rematch, disabled, hint "Opponent left". Gone beats every other state.
  - local mode: always idle, and pressing it starts the new game at once.

## 4. Flow state machine
State: screen, overlay (none, howto, settings), mode (null, online, local), role (null, host, guest), notice (null or host-left), seats (the two seats of the local character select, src/logic/seats.js, or null). The reducer is pure and returns a new frozen object. Any event not listed for the current state returns the same object unchanged.

"Selecting" means: screen game, mode local, seats set and not both Ready (isSelecting). Online the seats live in the room, where the host decides (section 5); the flow keeps seats null and only picks the screens.

| Event | Allowed when | Result |
| --- | --- | --- |
| PLAY_ONLINE | menu, overlay none | screen lobby, mode online, role null, notice null |
| PLAY_LOCAL | menu, overlay none | screen game, mode local, seats two empty seats (player1, player2) |
| OPEN_HOWTO | menu, overlay none | overlay howto |
| OPEN_SETTINGS | menu, overlay none | overlay settings |
| CLOSE_OVERLAY | menu, overlay set | overlay none |
| BACK | lobby | screen menu, mode null, notice null |
| BACK | menu, overlay set | overlay none |
| ROOM_CREATED | lobby | screen waiting, role host, notice null |
| JOINED | lobby | screen starting, role guest, notice null |
| OPPONENT_JOINED | waiting | screen starting |
| START | starting | screen game |
| OPPONENT_LEFT | starting, role host | screen waiting |
| OPPONENT_LEFT | starting, role guest | screen lobby, role null, notice host-left |
| LEAVE | waiting or starting | screen menu, mode null, role null, seats null |
| LEAVE | selecting (Back on the local character select) | screen menu, mode null, role null, seats null |
| LEAVE | gameover | screen menu, mode null, role null, seats null |
| PICK { seat, character } | selecting, and the seat rules accept it | seats with the pick (the first pick of a seat joins the pick order) |
| READY { seat } | selecting, and the seat has a pick | seats with the seat Ready; when both are Ready the local game starts (no longer selecting) |
| GAME_OVER | game, not selecting | screen gameover |
| REMATCH_STARTED | gameover | screen game (seats kept: same characters, same sides) |

Before step 4 the app still starts on the lobby (initialFlow option startScreen). From step 4 it starts on the menu. initialFlow with local true starts on the game in local mode with two empty seats, so ?local=1 opens on the character select.

A PICK refused by the seat rules (a character taken by the other seat, an unknown character or seat, a pick after Ready) and a READY without a pick return the same object.

## 5. Network protocol (additions)
All messages keep the existing envelope. New messages:
- welcome (changed): carries seats (the two seats, host and guest) instead of the characters; its state is null until the game started.
- pick: guest to host. Fields: character, request. The guest's pick for its seat. request numbers the guest's picks and Readys from 1; a pick or Ready sent again after a host ping gets a new number.
- ready: guest to host. Fields: character, request. The guest pressed Ready for the pick character (its last pick sent). The host refuses it (reason pick-changed) when the seat holds another character, so a Ready that follows a refused pick never locks the guest on its older pick.
- seats: host to guest after every change of the seats, and as the answer to every pick and ready. Fields: seats; answer (the request it answers); error and reason when the host refused the guest's request (reason taken, ready, no-pick, pick-changed, unknown-character). The guest takes an error only when answer is its last request: a refusal of an older request while a newer one is on its way is dropped, so a host ping never brings an old pick back.
- start: host to guest, sent when both seats are Ready. Fields: round (1), state (the fresh game of the pick order), seq, seats. The guest enters the game when it arrives, never on its own.
- rematch: asks for a rematch. Field: round (the round of the game that just ended). The guest sends it to the host; the host's own press is a local call with the same effect.
- rematch-status: host to guest after every change. Fields: round, host (boolean), guest (boolean).
- new-game: host to guest when both flags are true. Fields: round (previous round plus 1), state (the full fresh state, same shape as in welcome).

Round: an integer, 1 for the first game of a room, stored by the host. A message whose round is not the host's current round is ignored (no state change, no reply).

Host rules, in order:
1. A join is accepted only in phase waiting. Otherwise answer full.
2. On an accepted join: phase starting, answer welcome with the seats. No timer.
3. A pick or Ready (the host's own, or the guest's message) counts only in phase waiting or starting (the guest's only in starting). The seat rules decide: a character taken by the other seat, an unknown character or a pick after Ready is refused, and Ready needs a pick (and is refused when it names a pick the seat no longer holds). A repeat of the seat's own pick changes nothing and is never refused, even after Ready (the guest may send a pick and Ready again after a late host ping). The first pick plays X. Every change is sent to the guest as seats; a refused guest request is answered with seats and the error.
4. When both seats are Ready (phase starting): newGame with the sides of the pick order, phase playing, send start (round 1, the state and the seats). The host screen goes to the game at the same moment.
5. If the guest leaves during starting: its seat becomes empty (no pick, not Ready, out of the pick order), phase waiting, the room accepts a new join. The host's own pick and Ready stay.
6. An action that arrives before phase playing is rejected with reason not-started and changes nothing.
7. When the game ends (win, draw or forfeit): phase over, rematch flags cleared.
8. rematch in phase over with the current round, and the game did not end by forfeit: set the sender's flag and broadcast rematch-status. If both flags are true: round plus 1, newGame with the same characters on the same sides, phase playing, send new-game, clear the flags, reset heartbeat state and any leave countdown.
9. rematch in any other phase, or after a forfeit: ignored.
10. Peer gone in phase over: flags cleared, rematch is disabled for good in this room (the UI shows Opponent left).

Recovery: the host's pings in phase starting carry the seats, so a guest whose pick or ready (or its answer) was lost sends it again; a guest still in starting whose start was lost sees the round in the host's ping and asks again (join), and the host answers with welcome and start.

newGame (pure, shared by the host, local mode and rematch): empty board, no rocks, no pending Wind Dash, no active Tornado Zone, every cooldown 0, X (the first pick) to move, same characters on the same sides, no winner. Random picks keep using the injected random function.

## 6. Presence by phase
| Phase | Peer silent or leave message |
| --- | --- |
| waiting | Nobody is there. Nothing happens. |
| starting | Host: the guest seat is empty again, back to phase waiting. Guest: leaves for the lobby with the notice host-left. |
| playing | As today: after 3 seconds of silence (or a leave message) the 10 second countdown starts; at 0 the other player wins by forfeit. |
| over | No countdown and no forfeit. The room reports peer gone once, and the game over card shows Opponent left. |

The heartbeat keeps running in every phase. Silence is only judged by the rule of the current phase.

## 7. Shot scenes and checks
New scenes for docs/shots.md (static, no network, every one built from a fixed view model):
- menu, howto, settings, lobby, waiting, starting, select: background is the empty scene. Room code fixed to ABCD5. waiting and starting use role host, whose seat picked Wind Rabbit. select is the local character select with Player 1 Ready on Wind Rabbit and Player 2 to pick.
- gameover and gameover-pending: background is the field scene, Wind Rabbit wins, online viewer. gameover-pending has the Rematch state mine.
- Every button, panel and card carries a data-hud-box name (for example menu-play-online, menu-play-local, menu-howto, menu-settings, howto-panel, howto-close, settings-panel, settings-close, lobby-back, lobby-create, lobby-join, waiting-code, waiting-copy, waiting-leave, card-host, card-guest, gameover-card, gameover-rematch, gameover-menu).
- tools/shots.sh gets a set called flow with all of these scenes at every viewport in shots.config.json (at least 1920 by 1080 and 1280 by 720).
- Pass numbers from shots/report.json, per scene and viewport: box overlaps 0, boxes outside the viewport 0, smallest button side at least 44 px, console errors 0. The game over card is also at most 24 percent of the viewport height and overlaps no HUD card.
- Step 7 adds tools/flow_e2e.py and the set e2e: two pages in one browser context walk the real flow and write shots/e2e.json.

## 8. Text, style and keyboard
- All text of the new and touched screens lives in src/ui/strings.js, one flat English object. Numbers inside text come from src/config.js or SKILL_INFO, never typed twice.
- New CSS uses the existing glass tokens only. No new hex colour literals outside the token block (a test reads the new CSS file).
- Font: the DM Sans files already in assets/fonts.
- All controls are real button, input or select elements. Status text, errors and the Copied message are in aria-live polite regions.
- Global key shortcuts (HUD toggle C with fallbacks H and V, Fullscreen F and Z) must ignore events from typing targets (input, textarea, select, contenteditable) through one pure isTypingTarget(element). Room code letters include C, F, Z, H and V, so without this guard typing a code would toggle the HUD or the fullscreen.

## 9. Owner checklist (after step 7)
1. Reload the page. The menu is the first screen, the farm is behind it, there are four buttons.
2. Play on this computer: the game starts. Play until someone wins. Press Rematch: a clean board appears at once, no old plants, rocks or banners. Press Back to Menu.
3. How to Play: the skill numbers read 3, 6 and 4 turns, the four skill texts are there, nothing is cut off at the window size you use.
4. Settings: switch Low, Medium, High. The page does not reload. The Fullscreen button works.
5. Two windows of the same browser: window A creates a room and picks Wind Rabbit, window B joins with the code. B sees Wind Rabbit taken and picks another character. Both press Ready: both enter the game at once, A plays X.
6. Type a code containing C, F, Z, H or V in the join box. Nothing else happens (no fullscreen, no HUD toggle).
7. Wrong code: a clear message appears under the box, no pop-up.
8. In an online game close window B. Window A shows the 10 second countdown, then the game over card. Rematch is disabled with Opponent left. Back to Menu works.
9. Win an online game. Press Rematch in window A only: it says it is waiting, window B says Opponent wants a rematch. Press Rematch in B: both get a clean board with the same characters on the same sides, X first.
10. Leave in the waiting room: the menu appears. Join with the old code from the other window: not found.

## 10. Later ideas (not in this version)
- An invite link that opens the lobby and joins by itself.
- Swap sides on rematch (Gomoku gives the first player a real advantage).
- A Menu or Leave button during a game (it would send the existing leave message, so the other player gets the normal countdown).
- Remember the last chosen character.
- A WebSocket transport and real play across two computers (then onlineSameBrowserOnly(config) is false).
- Vietnamese text (strings.js is the single place to translate).
