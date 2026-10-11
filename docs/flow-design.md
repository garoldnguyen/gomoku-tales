# Gomoku Tales: Flow Design (menu, waiting room, rematch)

Status: plan for the tasks "Flow v1, step 1 of 7" to "Flow v1, step 7 of 7" in .millstone/tasklist.md, changed by "Game v5, part 2 of 3" (the character select with Ready, sides by pick order, no automatic start). It extends docs/design.md section 3 (Screens) and section 6 (Online rooms). Step 7 folds the final behaviour back into those sections. All game text is English (Vietnamese is out of scope, see section 10).

Names in this file (flow.js, strings.js, newGame, start, rematch and so on) are descriptive. If the code already has a module, function or message for the same job, reuse it and keep its name.

## 1. Goals
1. A main menu is the first screen.
2. A room shows both players before the game starts; each picks a character and presses Ready.
3. The game over screen has a Rematch button. The host decides, like everything else online.
4. Every screen is testable three ways: pure view models in node tests, scenes in shot mode (docs/shots.md), and one end to end run in a real browser (step 7).

## 2. Decisions
1. Menu: five buttons. Play Online (goes to the lobby), Play on this computer (the ?local=1 mode, two players in one window), Watch a match (a spectator of an online room, sections 3.8 and 3.9), How to Play, Settings.
2. Characters are picked inside the game, never in the lobby. There are four (Wind Rabbit, Earth Bear, Jade Serpent, Cloud Eagle) and two seats. Each player picks a character for their seat and presses Ready. A character picked by one seat is disabled for the other seat. The first pick plays X and moves first, the second plays O (assignSides). A seat may change its pick until it is Ready (it keeps its place in the pick order); Ready needs a pick and locks it. The game starts when both seats are Ready. There is no automatic start and no timer (WAITING_START_DELAY_MS is gone), and there is no request button.
   - Online: the host owns the start. The guest sends its pick and its Ready to the host, the host checks them with the same seat rules (src/logic/seats.js), updates the room and answers with the seats. When both seats are Ready the host sends start with round 1. The guest enters the game only on start.
   - Local (Play on this computer): the game screen opens on the character select with the seats Player 1 and Player 2, both picked in the one window; the local game starts when both are Ready.
3. Rematch needs both players to press it. Same characters, same sides, X (the first pick) moves first. Swapping sides is not part of this version.
4. A join is accepted only while the room is in phase waiting. In any other phase the answer is full.
5. Online play uses the transport of ONLINE_TRANSPORT (src/config.js, read only by chooseTransport): broadcast links windows of the same browser on the same computer (BroadcastChannel), websocket goes through the relay server (worker/) so players on different computers can meet. The UI learns which one from a single function, onlineSameBrowserOnly(config) in src/net/transport.js (true only for broadcast); there is no separate flag. Only for broadcast the lobby shows the same-browser hint line. With websocket the host's Create reads Connecting until its relay connection is open, a host that cannot connect stays on the lobby with the connection error, and a guest the relay refuses sees No room found at once. A relay connection lost after it opened closes the room: a pending join shows the connection error on Join Room, and the waiting room (host or seated guest), a game in play and the game over card go to the lobby with it (a game in play is not left to the presence countdown, which would call the disconnected window the winner).
6. Out of scope: computer opponent, Vietnamese text, sound and music, accounts, more maps. (The phone touch layout of section 3.10 and play across two computers over the relay exist now.)

## 3. Screens
Every screen is a DOM layer over the existing 3D world in the Ivory look (see 3.0). No second WebGL renderer and no new canvas. Every screen is drawn from a pure view model so that shot mode can draw it without a network.

### 3.1 Menu
```
+--------------------------------------+
|            Gomoku Tales              |
|                                      |
|          [ Play Online ]             |
|     [ Play on this computer ]        |
|         [ Watch a match ]            |
|          [ How to Play ]             |
|           [ Settings ]               |
+--------------------------------------+
```
- Background: the 3D world with the empty field (the look of shot scene empty).
- Story (docs/skill-popup-design.md section 4): between the title and the buttons, on the menu screen only, a gold spaced-capitals kicker (STRINGS.menuStoryKicker) over a short centred line (STRINGS.menuStoryLine, at most 36em wide) in the secondary ink, data-hud-box menu-story; it fades in with the menu (opacity only) and is hidden when the window is shorter than 560 px so the buttons never move under the fold.
- Buttons are real button elements in one column, centred horizontally, in the order above. Each is at least 44 px high and 240 px wide, with at least 12 px between buttons. The whole menu fits inside 1280 by 720 without scrolling.
- The first button has focus when the menu appears. Tab follows the visual order. Enter and Space activate. The focus ring is 2 px, from the existing tokens.
- Play on this computer opens the same local game screen as ?local=1, on the character select of Player 1 and Player 2 (section 3.6). No You tag.
- Watch a match (data-hud-box menu-watch, event WATCH) opens the spectator's room code screen (section 3.8).
- ?local=1 in the URL still skips the menu. ?shot= scenes also skip it.

### 3.2 How to Play
- A glass panel at most 720 px wide and 80 percent of the viewport high. It scrolls inside itself. The Close button is 44 px. Escape closes it and focus returns to the button that opened it.
- Seven rules lines, produced by a pure rulesLines(config) that reads the numbers from src/config.js and the skill names from the skill table and SKILL_INFO. Each sentence was checked against src/logic and the rules are never changed to fit a sentence:
  1. Two players take turns. The player who picked a character first plants X and always goes first. The other plants O. (No character is named: the side comes from the pick order, any of the four may be X or O.)
  2. On your turn you may use one skill that is ready. A skill is a free action: it never ends your turn. Then you must plant a seed on an empty plot to end your turn. (Free Action, docs/design.md section 4)
  3. 5 or more of your plants in an unbroken row, across, down or diagonally, win the game. (number: WIN_LENGTH)
  4. After you use a skill it rests for your next 3 turns (Wind Dash, Mud Trap, Hiss) or your next 6 turns (Tornado Zone, Petrification, Venom, Cloud). Sky Watch is always on and never rests. (numbers: COOLDOWN_SHORT, COOLDOWN_LONG; the two lists follow the cooldown class of each skill in src/logic/skills.js)
  5. A mud puddle dries after 4 turns, counting both players' turns. A seed planted in it counts for no row for 1 turn. A rock blocks a plot for both players for good. (numbers: MUD_LIFETIME_TURNS, MUD_SINK_TURNS)
  6. If the board fills up and nobody has 5 in a row, the game is a draw.
  7. Point at a plot to see the plant that would grow there, and click to plant it. On a touch screen, tap once to preview and tap again to plant. (the glowing hover plot and its ghost plant, docs/art-direction-v3.md section 3)
- Then all four characters in the order of the character table (Wind Rabbit, Earth Bear, Jade Serpent, Cloud Eagle), each with its portrait, its name and, for each of its two skills, the icon, the name, the rest ("Rests 3 turns", or "Always on" for the passive Sky Watch) and the description from SKILL_INFO. A character has no fixed side, so there is no X or O letter and each group takes the mark colour of its character (`--team`, set from CHARACTER_LOOK). Skill text is never copied; it is read from SKILL_INFO.

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
+-------------------------------------------------------------------------+
|                         Pick your character                             |
|                          ABCD5   [ Copy ]                               |
|            Open a second window of this browser and join.               |
|              The first to pick plays X and moves first.                 |
|  +------------+  +------------+  +------------+  +------------+         |
|  | (cross) GH |  | (bloom) MB |  | (leaf)  JS |  | (cloud) CE |         |
|  | Wind Rabbit|  | Earth Bear |  | Jade Serp. |  | Cloud Eagle|         |
|  | Wind Dash 3|  | Mud Trap  3|  | Hiss      3|  | Sky Watch  |         |
|  | Tornado   6|  | Petrific. 6|  | Venom     6|  | Cloud     6|         |
|  +------------+  +------------+  +------------+  +------------+         |
|  [ Leave ]  (X You: Wind Rabbit) (Opponent: Choosing)          [Ready]  |
+-------------------------------------------------------------------------+
```
- Four character cards in one row, in the order of CHARACTERS (Wind Rabbit, Earth Bear, Jade Serpent, Cloud Eagle; data-hud-box pick-<seat>-<character>, for example pick-host-cloud-eagle) for this window's seat: the portrait, or while it is missing the emblem (the blue four-petal cross for Wind Rabbit, the red round bloom for Earth Bear, the jade circle with a leaf for Jade Serpent, the pale yellow cloud with a feather for Cloud Eagle), a seal (a small rounded square with the initials GH, MB, JS or CE in the card colour), the name, a tagline and one row per skill with its rest turns (COOLDOWN_SHORT or COOLDOWN_LONG; Cloud Eagle's passive Sky Watch says Always on instead). The four cards share the panel width (SELECT_CARD_INNER_U in src/ui/room-screens.js), so the portrait scale is chosen for four cards. The picked card has a gold outline. On phones the four cards stack, the emblem on the left, and Ready spans the panel above Leave.
- Any two of the four may meet: the pick order alone gives the sides (the first pick plays X), so Cloud Eagle can play X or O like the others.
- Under the cards one row: Leave (or Back on this computer), the two seats, and Ready (ready-<seat>). Leave, Back and Ready are at least 44 px high.
- Two seats side by side: the host's on the left, the guest's on the right (data-hud-box card-host and card-guest). Each seat shows the stone of the pick order (X for the first pick, O for the second), its label (You or Opponent), its pick and its state (Choosing or Ready).
- The cards and Ready act for this window's own seat (data-hud-box pick-host-wind-rabbit and so on, ready-host or ready-guest). A character taken by the other seat is disabled and says Taken. Ready is disabled until the seat has a pick. Once pressed it reads Unready (owner's request, October 2026): a press takes the seat back to choosing with its pick kept (setUnready in src/logic/seats.js; the guest sends unready, the host answers with seats), so the seat may change its pick and press Ready again. The game starts the moment both seats are Ready, so an Unready can only come before that.
- The lead line says: The first to pick plays X and moves first.
- Phase waiting (no guest yet): title Waiting for opponent. The host may already pick and press Ready. The guest seat is a dimmed placeholder with the text Waiting and a slow pulse (opacity 0.6 to 1 over 1.6 seconds, off when prefers-reduced-motion is set).
- Phase starting (both seated): title Pick your character. Both seats show. After this window pressed Ready the line Waiting for the other player shows until the host starts the game. When both seats are Ready the host sends start and both players enter the game at once.
- The guest's pick and Ready are only requests: the seats it shows are the host's. A pick known to be refused (a taken character) is not sent.
- Leave is enabled in both phases. It closes the transport, stops every timer and returns to the menu (event LEAVE). The other window is told by the leave message: a guest who leaves before both are Ready returns its seat to empty (no pick, not Ready, out of the pick order) and the host waits again; a host who leaves sends the guest to the lobby with the notice host-left. The code can no longer be joined after the host left.
- The room code is shown at least 40 px high with letter spacing. Copy copies the code and shows Copied for COPY_FEEDBACK_MS. If the clipboard API is missing or rejects, select the code text and show Press Ctrl+C.

### 3.6 Game
No visual change. A rematch returns to this screen with a clean board.

In local mode (Play on this computer and ?local=1) the game screen opens on the character select (data-hud-box select-panel): the same layout as section 3.5 without the code: the three character cards, the seats Player 1 and Player 2 (card-player1, card-player2), Ready, and a Back button (select-back, also Escape) that returns to the menu. The cards and Ready act for the active seat (outlined): Player 1 by default, but either seat may pick first: pressing the other seat's card makes it the active seat. When the active seat is Ready the cards pass to the seat that is not Ready yet; pressing a Ready seat's card takes the cards back to it, where Ready reads Unready. A character picked in one seat is disabled for the other. The first pick plays X and moves first. The game starts when both seats are Ready; a rematch (and R) keeps the same characters on the same sides.

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

- Large card (owner's choice, October 2026): the card is about 640 px wide and centred in the window, with the result in a big light title, a short gold line, two wide buttons and a small View board button under them. View board folds the card into a small Show result pill under the turn pill (this window only; it is not a flow screen), so the finished board and the winning line can be read; Show result opens it again, and every new game over starts open. On phones the two buttons stack. The screenshot check allows the card up to 60 percent of the window height (GAMEOVER_MAX_HEIGHT_SHARE in tools/shots.py).

### 3.8 Watch a match: the room code screen (flow screen spectate)
```
+--------------------------------------+
|            Watch a match             |
|  Enter the code of a room to watch.  |
|   Room code [ ABCD5 ]   [ Watch ]    |
|   No room found with code ABCD5.     |
|              [ Back ]                |
+--------------------------------------+
```
- A glass card like Join Room (data-hud-box spectate-panel, spectate-code, spectate-submit, spectate-back). The code box works like the join box of section 3.4 (normalized, Watch disabled until the code is whole, Enter submits). Errors appear inline in an aria-live polite region and clear when the player types.
- Watch opens a relay connection to the room as role spectator through ws-transport (src/net/ws-transport.js), whatever ONLINE_TRANSPORT says: the BroadcastChannel has no spectators. While it opens Watch reads Connecting and the box is disabled. A refused connection (no host in the room, or the room is full of spectators, SPECTATOR_LIMIT) shows No room found with code X. Back (and Escape) returns to the menu and drops a connection still opening.
- The spectator room (src/net/spectator-room.js) only listens. It never sends a message (the relay closes a spectator that sends), has no seat, no heartbeat and no presence, so it is never in the leave countdown, and the players never learn it is there. It builds the room from the relay's replay (the last seats, state, start, new-game and rematch-status of the host) and every live host message; a state with an older seq than the one shown is dropped. The host sends its seat changes even before a guest is in, so a spectator sees the host's pick.

### 3.9 Watching (flow screens spectate-waiting, spectate-game, room-closed)
- spectate-waiting: while the room has no game, the spectator sees the waiting room of section 3.5 read-only: title Waiting for the game, the code with Copy, the hint "You are watching. The game shows here when both players are Ready.", the seats Host and Guest (the guest a dimmed Waiting placeholder until a guest is in, and again if the guest goes before the start: the host's seats message carries guest false, sent to nobody so only spectators take it) with their picks and Ready states, the three character cards all disabled, no Ready button, and Leave reading Stop watching.
- spectate-game: once the first game state arrives (the start, or the replay of a game already running) the spectator sees the live board, the HUD and a compact watch card (data-hud-box watch-card) placed by watchCardBox in src/ui/hud-layout.js so it never covers a plot: in the lower left beside the field below the left HUD card, under the upright HUD bar in the left strip of small landscape windows, and between the field and the slim HUD bars on narrow windows (above the field under the top bar where that room is too short). Where the full card does not fit it is one slim row with only the title and Stop watching. The card shows: Watching room ABCD5, the player names Wind Rabbit (X) vs Earth Bear (O), the phase line (whose turn, X wins, Draw, or X wins, the opponent left) and Stop watching (watch-leave). Input is locked: no hover, no cell clicks, no skill buttons (every skill row of the HUD is disabled, the turn pill says You are watching), no target flow and no game over card. A rematch (new-game) shows the clean board of the next round on the same screen.
- room-closed: when the host leaves (its leave message, or the relay's leave when the host's socket closes) or the spectator's connection is lost, the spectator sees the notice Room closed (data-hud-box room-closed-card) with the line "The host left, so the room is closed." and a Back to Menu button (room-closed-menu) that returns to the menu.
- Who watches (owner's request, October 2026; src/net/audience.js): the players and the other spectators see the spectators. A spectator sends watch with its name when it connects (and again when a guest is welcomed) and unwatch when it stops; the relay keeps the list itself, as the spectators' sockets come and go (a closed tab sends nothing), and sends everyone the audience message after each change and to a player who connects while spectators watch. Over the BroadcastChannel the watch and unwatch messages go to everyone directly. The chat corner shows an eye button with the number of watchers (data-hud-box chat-watchers; a press lists their names, chat-watcher-list), in the waiting room and in the game, and each spectator coming or going adds a quiet line to the chat (Calm Owl is watching, Calm Owl stopped watching) that pops up like a message.
- All text lives in src/ui/strings.js. Shot scenes: spectate (the empty code box), spectate-game (the field scene watched, with the watch card) and room-closed.

### 3.0 The Ivory look (all screens of this section)
The menu, How to Play, Settings, the lobby, Join, Watch a match, the waiting room, the character select, Room closed, the game over card and the watch card share one look, chosen by the owner over a dark "obsidian and gold" option:
- A warm ivory wash over the softly blurred farm (the menu scrim, the lobby screens and the select; the game over and watch cards stay over the clear board). Ivory paper cards with a hairline border, square corners and a soft warm shadow.
- Type: one typeface, Jost (a geometric sans, variable weight; src/ui/ivory.css, the font in assets/fonts with its OFL licence, FONTS.txt), chosen by the owner over the earlier Cormorant Garamond and Cinzel as simpler and easier to read: titles and names large and light (300 to 500), labels and buttons small spaced capitals (500), running text regular. Nunito stays only as the fallback and for the canvas text.
- Gold (#86642a, 5.3:1 on the ivory paper, WCAG AA for small text) for small capital labels, hairlines, the selected card's frame and the focus lines; ink (#1c1913) for text and the one solid button (Ready); faded ink no lighter than 62 percent (about 4.9:1).
- The menu has no card and little ink: the place in gold capitals, the title light with its last word in gold, a short gold line, then five single-word choices with air between them (no rules; each choice's one-line hint is kept for screen readers only); the focused one turns to full ink and a short gold line grows under it. On touch screens the keys line is hidden. It fits 1280x720 (MENU_LAYOUT), short windows and phones (media rules in menu.css).
- The character select: paper cards with the portrait on a soft glow of the character colour, the name and tagline in Jost, skill rows divided by hairlines with the rest turns in small gold capitals; the pick is framed in gold and lifted; taken cards are dimmed to grey.
- Every colour is a token: the Ivory palette is the #screens block of src/ui/screens.css, and the token blocks of menu.css and room.css take their colours from it (tests check this). The in-game glass HUD (hud.css) keeps its dark glass and tokens, with the Ivory accents of section 3.10.
- The canvas draws no title under any DOM screen; each screen has its own (the lobby card says Play Online).

### 3.10 Help in the game: turn banner, first-game hints, touch, invite link, HUD accents
- Turn banner (src/ui/announce.js, announce.css): in a game on one screen, at the start and every time the turn passes, a small dark glass pill under the turn pill names the character to move ("To play", then the name in the character's colour, on one line). It slides in from the right, holds and slides on to the left within TURN_BANNER_MS, never covers the middle of the board and takes no clicks; the hint card sits below it. Online and for spectators there is none (each window already knows its side).
- First-game hints: a small dark glass card under the turn pill (data-hud-box hint-card) with a title, one or two lines and Got it. Each hint shows once per browser (localStorage key gomoku.hints.seen; a blocked storage only means it may show again): Five in a row wins (the first game), what a skill does with how to cancel it (the first time each skill is picked, words from SKILL_INFO) and Tap again to plant (the first touch preview). Hints queue one at a time and close after HINT_MS or Got it. Spectators get none. Neither the banner nor the hints show in shot mode.
- Touch (src/ui/input.js createTouchConfirm): on a touch screen the first tap on a plot previews it (the hover ring), a second tap on the same plot plants; a tap on another plot moves the preview. Mouse and pen plant on the first click as before. Picking a skill or cancelling clears the preview.
- Invite link: in the waiting room, while the host waits alone, Copy invite link (data-hud-box waiting-invite) copies this page with ?join=CODE (inviteLink in room-screens.js; ?local and the hash are dropped). Where the clipboard is refused the link itself shows under the code row, selectable, for INVITE_LINK_SHOW_MS. Opening the link on the menu runs Play Online and Join Room through the ordinary flow events (app.joinFromLink) with the code filled in; the player types or keeps a name (Your name, join-name, focused first) and presses Join (owner's request, October 2026: the link used to join at once with no name step). The parameter leaves the address bar so a reload does not open it again. A bad code stays on Join Room with its error. With the BroadcastChannel transport the link only works in the same browser, as the code does.
- HUD accents (end of src/ui/hud.css): the HUD keeps its dark glass; all its text is Jost, the small SKILLS label spaced capitals in pale gold (#e8c77a), and a gold hairline runs along the top of each card, the card rule and the turn pill border.

### 3.11 Motion
Research basis: entrances of about 200 to 500 ms with an ease-out curve (cubic-bezier(0.22, 1, 0.36, 1)), exits shorter (about two thirds) with an ease-in, small staggers between items of a list, and only opacity and transforms animated so the browser composites them without layout. Every animation is off under prefers-reduced-motion (the shots and the end to end check run that way, so their pictures stay still).
- Menu (menu.css): the wash fades in, the title rises, then the five choices one after another (--i set by menu-dom.js, 60 ms apart), then the keys line. How to Play and Settings grow in while the menu fades behind them, and fade out on Close. Leaving the menu fades it out.
- Screens (screens.css, screens.js): a card that appears fades and rises in; the card it replaces is pinned where it stood and fades out in LEAVE_MS, so the two cross. On a new screen the four character cards come in one after another, then the seats (--i set by screens.js, for ENTER_STAGGER_MS after the screen appears, so a later pick does not replay it). The whole layer fades out when the game begins, and the game over card rises in.
- src/ui/motion.js createFader keeps a leaving node shown with the class is-leaving for LEAVE_MS, then hides it; showing it again cancels the leave; under reduced motion it hides at once.

### 3.12 Player names and room chat
- Names: Play Online and Watch a match have a Your name box (data-hud-box lobby-name and spectate-name; both show the same text). It starts with the name saved in this browser (gomoku.player.name); an empty box suggests a random name, an adjective and an animal from two lists of 100 words each (src/ui/player-names.js), and that suggestion is used and saved when the box stays empty. Names are cleaned (src/net/chat.js cleanName: no control characters, single spaces, at most NAME_MAX_LENGTH characters). The guest sends its name with join; the host sends the names of both seats ({ host, guest }) with every message once one is known, so the guest and the spectators learn them too. They label the seats of the waiting room (yours as Name (you)) and lead the HUD card line online (Name . Plays X, n planted). Join Room has the same Your name box (join-name), so a guest arriving by an invite link names itself before it joins.
- Chat: a dark glass panel in the lower left (top right on phones) for everyone in an online room: both players and every spectator, in the waiting room, the game and the game over card (not on one screen). It starts folded into a round Chat button that counts unread messages; open, the browser's resize handle in its corner makes it larger or smaller, and the fold button hides it again (the choice is kept in this browser). Messages are { name, text } (CHAT_MAX_LENGTH characters, at most one every CHAT_MIN_INTERVAL_MS per window, the last CHAT_HISTORY shown). The chat is cleared when a rematch begins and when the room is left; the first start keeps the waiting room's messages. The relay passes chat from anyone to everyone else, and lets a spectator send chat and nothing else (worker/pairing.js routeFor and maySend). Over the BroadcastChannel every window of the room gets it the same way.
- New message popup (owner's request, October 2026): while the chat is folded, each new message of someone else (and each spectator coming or going) shows for CHAT_TOAST_MS in a small dark glass popup by the Chat button (data-hud-box chat-toast: the name in gold, the text on at most two lines); a press on it opens the chat. A newer message replaces it; nothing pops up for this window's own messages, while the chat is open, or for the messages already there when the chat appears.

### 3.13 Leave match
- On the game screen (online and on this computer, never for a spectator, not on the character select) a 44 px glass circle with a door mark (data-hud-box leave-match, aria label Leave match) sits where topBarLayout in src/ui/hud-layout.js puts it: in the top left corner beside full HUD cards (the turn pill keeps TURN_SIDE_ROOM free there), left of the Fullscreen button in the slim layouts, and under the quality switch with the Fullscreen button on narrow phones (toolsBelow; the turn pill's room in hud.css follows). hudBoxes counts it, so the overlap checks cover it.
- A press asks first in a small card in the middle (leave-confirm): Leave the match?, then "Your opponent wins this game, and the room closes." online or "This game ends and you go back to the menu." on this computer, with Keep playing and Leave match. Escape or Keep playing closes it.
- Leave match (app.leaveMatch, event LEAVE from the game screen) closes the room with resign: the leave message carries resign true in phase playing, and the other side takes the win at once (Opponent left on its game over card) instead of after the leave countdown. Then the menu.

## 4. Flow state machine
State: screen, overlay (none, howto, settings), mode (null, online, local), role (null, host, guest, spectator), notice (null, host-left or room-closed), seats (the two seats of the local character select, src/logic/seats.js, or null). The reducer is pure and returns a new frozen object. Any event not listed for the current state returns the same object unchanged.

"Selecting" means: screen game, mode local, seats set and not both Ready (isSelecting). "Spectating" means: screen spectate-waiting or spectate-game (isSpectating); a spectator only ever reaches the screens spectate, spectate-waiting, spectate-game and room-closed, and none of them takes a pick, a Ready, a cell or a skill. Online the seats live in the room, where the host decides (section 5); the flow keeps seats null and only picks the screens.

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
| WATCH | menu, overlay none | screen spectate, mode online, role spectator, notice null |
| BACK | spectate | screen menu, mode null, role null, notice null |
| SPECTATOR_JOINED | spectate | screen spectate-waiting (the relay connection is open) |
| START | spectate-waiting | screen spectate-game (the first game state arrived) |
| ROOM_CLOSED | spectate-waiting or spectate-game | screen room-closed, notice room-closed |
| LEAVE | spectate-waiting, spectate-game or room-closed (Stop watching, Back to Menu) | screen menu, mode null, role null, notice null |

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
- unready: guest to host. Field: request. The guest pressed Unready; the host answers with seats.
- leave (changed): may carry resign true (Leave match in phase playing): the side that gets it wins at once, with no leave countdown.
- watch, unwatch: a spectator says it watches (with its name) or stops. audience: the relay to everyone, { watchers: [{ id, name }] } after every change (src/net/audience.js, section 3.9).
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

newGame (pure, shared by the host, local mode and rematch): empty board, no rocks, no mud, no sunk seed, no pending Wind Dash, no active Tornado Zone trap, no Venom zone, no Hiss lock, no skill used, every cooldown 0, X (the first pick) to move, same characters on the same sides, no winner. Random picks keep using the injected random function.

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
- New CSS uses the Ivory palette tokens only (section 3.0). No hex colour literals outside a token block (a test reads each CSS file).
- Font: the DM Sans files already in assets/fonts.
- All controls are real button, input or select elements. Status text, errors and the Copied message are in aria-live polite regions.
- Global key shortcuts (HUD toggle C with fallbacks H and V, Fullscreen F and Z) must ignore events from typing targets (input, textarea, select, contenteditable) through one pure isTypingTarget(element). Room code letters include C, F, Z, H and V, so without this guard typing a code would toggle the HUD or the fullscreen.

## 9. Owner checklist (after step 7)
1. Reload the page. The menu is the first screen, the farm is behind it, there are five buttons.
2. Play on this computer: the game starts. Play until someone wins. Press Rematch: a clean board appears at once, no old plants, rocks or banners. Press Back to Menu.
3. How to Play: the seven rules lines, all four characters with their eight skills (the rests read 3 and 6 turns, Sky Watch Always on), nothing is cut off at the window size you use.
4. Settings: switch Low, Medium, High. The page does not reload. The Fullscreen button works.
5. Two windows (two computers over the relay, or two windows of the same browser with ?transport=broadcast): window A creates a room, window B joins with the code. In the character select A picks Wind Rabbit; B sees Wind Rabbit taken and picks another character. Both press Ready: both enter the game at once, A (the first pick) plays X.
6. Type a code containing C, F, Z, H or V in the join box. Nothing else happens (no fullscreen, no HUD toggle).
7. Wrong code: a clear message appears under the box, no pop-up.
8. In an online game close window B. Window A shows the 10 second countdown, then the game over card. Rematch is disabled with Opponent left. Back to Menu works.
9. Win an online game. Press Rematch in window A only: it says it is waiting, window B says Opponent wants a rematch. Press Rematch in B: both get a clean board with the same characters on the same sides, X first.
10. Leave in the waiting room: the menu appears. Join with the old code from the other window: not found.

## 10. Later ideas (not in this version)
- An invite link that opens the lobby and joins by itself (done: section 3.10).
- Swap sides on rematch (Gomoku gives the first player a real advantage).
- A Menu or Leave button during a game (done: Leave match, section 3.13).
- Remember the last chosen character.
- A WebSocket transport and real play across two computers (done: the relay, worker/, docs/deploy.md; onlineSameBrowserOnly(config) is false for it).
- Vietnamese text (strings.js is the single place to translate).
