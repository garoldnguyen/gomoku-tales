# Gomoku Tales: Flow Design (menu, waiting room, rematch)

Status: plan for the tasks "Flow v1, step 1 of 7" to "Flow v1, step 7 of 7" in .millstone/tasklist.md. It extends docs/design.md section 3 (Screens) and section 6 (Online rooms). Step 7 folds the final behaviour back into those sections. All game text is English (Vietnamese is out of scope, see section 10).

Names in this file (flow.js, strings.js, newGame, start, rematch and so on) are descriptive. If the code already has a module, function or message for the same job, reuse it and keep its name.

## 1. Goals
1. A main menu is the first screen.
2. A waiting room shows both players before the game starts.
3. The game over screen has a Rematch button. The host decides, like everything else online.
4. Every screen is testable three ways: pure view models in node tests, scenes in shot mode (docs/shots.md), and one end to end run in a real browser (step 7).

## 2. Decisions
1. Menu: four buttons. Play Online (goes to the lobby), Play on this computer (the ?local=1 mode, two players in one window), How to Play, Settings.
2. The waiting room starts the game by itself 1.5 seconds after the second player joins (config WAITING_START_DELAY_MS = 1500). There is NO Ready step. Reason: the creator picks a character and the joiner gets the other one, so there is nothing left to prepare; a Ready click adds one message, one more state and one more way to get stuck (one side never clicks). The Rematch button is already a mutual agreement. The phase "starting" (section 6) is the one place where a Ready step would go if it is ever wanted, for example with a turn timer or a character pick inside the room.
3. Rematch needs both players to press it. Same characters, same sides, Wind Rabbit (X) moves first. Swapping sides is not part of this version.
4. A join is accepted only while the room is in phase waiting. In any other phase the answer is full.
5. Online play still works only between windows of the same browser on the same computer (BroadcastChannel). The UI says so through one config flag, ONLINE_SAME_BROWSER_ONLY = true, which becomes false when a WebSocket transport exists.
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
- Play on this computer starts the same local game as ?local=1. Wind Rabbit (X) first, no You tag.
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
- Keep Create Room (pick Wind Rabbit or Earth Bear) and Join Room (code box).
- Add a Back button (event BACK, also the Escape key) that returns to the menu.
- When ONLINE_SAME_BROWSER_ONLY is true, show one hint line: online play works between two windows of the same browser on this computer.
- Code box: normalizeCodeInput(raw) uppercases, removes every character that is not in the room code alphabet (spaces, dashes and the confusing 0, O, 1, I vanish) and cuts to ROOM_CODE_LENGTH. Example: "ab c-d5xyz" gives ABCD5. The Join button stays disabled until the box holds ROOM_CODE_LENGTH characters. Enter submits.
- While the answer is pending the button shows Joining and is disabled, for at most JOIN_TIMEOUT_MS. Errors appear inline under the box (never an alert), in an aria-live polite region, and clear when the player types: room not found, room full, host left.

### 3.5 Waiting room (phases waiting and starting)
```
+--------------------------------------------------+
|                Waiting for opponent              |
|                     ABCD5   [ Copy ]             |
|  Open a second window of this browser and join.  |
|                                                  |
|   +------------------+   +- - - - - - - - - -+   |
|   | Wind Rabbit  X   |   |  Waiting...       |   |
|   | You              |   |                   |   |
|   +------------------+   +- - - - - - - - - -+   |
|                                                  |
|                  [ Leave ]                       |
+--------------------------------------------------+
```
- Two character cards side by side in the same order as the game HUD: Wind Rabbit (X) on the left, Earth Bear (O) on the right. They reuse the character data and portraits of the HUD. The own card carries the You tag.
- Phase waiting: title Waiting for opponent. The card of the other player is a dimmed placeholder with the text Waiting and a slow pulse (opacity 0.6 to 1 over 1.6 seconds, off when prefers-reduced-motion is set). Leave is enabled.
- Phase starting: title Opponent joined. Both cards are filled. The text Starting shows. Leave is disabled. After WAITING_START_DELAY_MS the host sends start and both players enter the game.
- The room code is shown at least 40 px high with letter spacing. Copy copies the code and shows Copied for COPY_FEEDBACK_MS. If the clipboard API is missing or rejects, select the code text and show Press Ctrl+C.
- The joiner sees the same room in phase starting for the 1.5 seconds, so both players see both cards.
- Leave (host, phase waiting) closes the transport, stops every timer and returns to the menu. The code can no longer be joined.

### 3.6 Game
No visual change. A rematch returns to this screen with a clean board.

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
State: screen, overlay (none, howto, settings), mode (null, online, local), role (null, host, guest), notice (null or host-left). The reducer is pure and returns a new frozen object. Any event not listed for the current state returns the same object unchanged.

| Event | Allowed when | Result |
| --- | --- | --- |
| PLAY_ONLINE | menu, overlay none | screen lobby, mode online, role null, notice null |
| PLAY_LOCAL | menu, overlay none | screen game, mode local |
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
| LEAVE | waiting | screen menu, mode null, role null |
| LEAVE | gameover | screen menu, mode null, role null |
| GAME_OVER | game | screen gameover |
| REMATCH_STARTED | gameover | screen game |

Before step 4 the app still starts on the lobby (initialFlow option startScreen). From step 4 it starts on the menu. initialFlow with local true starts on the game in local mode (this keeps ?local=1).

## 5. Network protocol (additions)
All messages keep the existing envelope. New messages:
- start: host to guest, sent when the start delay ends. Field: round. The guest enters the game when it arrives, never on a timer of its own.
- rematch: asks for a rematch. Field: round (the round of the game that just ended). The guest sends it to the host; the host's own press is a local call with the same effect.
- rematch-status: host to guest after every change. Fields: round, host (boolean), guest (boolean).
- new-game: host to guest when both flags are true. Fields: round (previous round plus 1), state (the full fresh state, same shape as in welcome).

Round: an integer, 1 for the first game of a room, stored by the host. A message whose round is not the host's current round is ignored (no state change, no reply).

Host rules, in order:
1. A join is accepted only in phase waiting. Otherwise answer full.
2. On an accepted join: phase starting, answer welcome as today, start a timer of WAITING_START_DELAY_MS.
3. When the timer fires: phase playing, send start (round 1). The host screen goes to the game at the same moment.
4. If the guest leaves during starting: cancel the timer, phase waiting, the room accepts a new join.
5. An action that arrives before phase playing is rejected with reason not-started and changes nothing.
6. When the game ends (win, draw or forfeit): phase over, rematch flags cleared.
7. rematch in phase over with the current round, and the game did not end by forfeit: set the sender's flag and broadcast rematch-status. If both flags are true: round plus 1, newGame, phase playing, send new-game, clear the flags, reset heartbeat state and any leave countdown.
8. rematch in any other phase, or after a forfeit: ignored.
9. Peer gone in phase over: flags cleared, rematch is disabled for good in this room (the UI shows Opponent left).

newGame (pure, shared by the host, local mode and rematch): empty board, no rocks, no pending Wind Dash, no active Tornado Zone, every cooldown 0, Wind Rabbit (X) to move, same characters on the same sides, no winner. Random picks keep using the injected random function.

## 6. Presence by phase
| Phase | Peer silent or leave message |
| --- | --- |
| waiting | Nobody is there. Nothing happens. |
| starting | Host: back to phase waiting. Guest: leaves for the lobby with the notice host-left. |
| playing | As today: after 3 seconds of silence (or a leave message) the 10 second countdown starts; at 0 the other player wins by forfeit. |
| over | No countdown and no forfeit. The room reports peer gone once, and the game over card shows Opponent left. |

The heartbeat keeps running in every phase. Silence is only judged by the rule of the current phase.

## 7. Shot scenes and checks
New scenes for docs/shots.md (static, no network, every one built from a fixed view model):
- menu, howto, settings, lobby, waiting, starting: background is the empty scene. Room code fixed to ABCD5. waiting and starting use role host and Wind Rabbit.
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
5. Two windows of the same browser: window A creates a room as Wind Rabbit, window B joins with the code. A shows the opponent card, then both enter the game after about 1.5 seconds.
6. Type a code containing C, F, Z, H or V in the join box. Nothing else happens (no fullscreen, no HUD toggle).
7. Wrong code: a clear message appears under the box, no pop-up.
8. In an online game close window B. Window A shows the 10 second countdown, then the game over card. Rematch is disabled with Opponent left. Back to Menu works.
9. Win an online game. Press Rematch in window A only: it says it is waiting, window B says Opponent wants a rematch. Press Rematch in B: both get a clean board, Wind Rabbit first.
10. Leave in the waiting room: the menu appears. Join with the old code from the other window: not found.

## 10. Later ideas (not in this version)
- A Ready step in phase starting.
- An invite link that opens the lobby and joins by itself.
- Swap sides on rematch (Gomoku gives the first player a real advantage).
- A Menu or Leave button during a game (it would send the existing leave message, so the other player gets the normal countdown).
- Remember the last chosen character.
- A WebSocket transport and real play across two computers (then ONLINE_SAME_BROWSER_ONLY becomes false).
- Vietnamese text (strings.js is the single place to translate).
