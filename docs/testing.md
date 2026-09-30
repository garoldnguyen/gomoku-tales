# Gomoku Tales: Manual Test (two windows)

A step-by-step check of online play in two browser windows, the four skills and the
disconnect handling. The rules are in [design.md](design.md); the unit tests
(`node --test`) cover the rules in detail, so this test focuses on what you see
and what reaches the other window.

Tick each box as you go. If a step fails, note the step, what you did and what you saw.

Cells are named (column, row) counted from the top-left corner, starting at 1. For
example (8, 8) is the centre of the 15x15 board.

## 1. Before you start

- [ ] Run the unit tests from the project root: `node --test`. All tests pass.
- [ ] Use Chrome (or another Chromium browser) in a normal profile. Do not use
      Incognito or a guest window for only one of the two windows: rooms link windows
      through a BroadcastChannel, which only works inside one browser profile.

## 2. Start the server

1. Open a terminal in the project root (the folder with `index.html`).
2. Run:

   ```sh
   python3 -m http.server 8000
   ```

3. Leave the terminal open. It prints a line for every file the browser loads.

- [ ] Open http://localhost:8000 in Chrome. The lobby shows the title "Gomoku Tales" over
      the hill scene with the buttons Create Room and Join Room.
- [ ] Open DevTools (F12) and check the Console. There are no script errors. A "404 (File
      not found)" line for each missing art file is expected while `assets/` holds only
      `manifest.json`; placeholders are drawn instead.

## 3. Open two windows side by side

1. In the first window press Ctrl+N (Cmd+N on macOS) to open a second window of the same
   profile, and open http://localhost:8000 in it. Use a new window, not a new tab, so
   both stay visible.
2. Put the windows side by side: on Windows press Win+Left in one and Win+Right in the
   other; on macOS or Linux drag them to the two halves of the screen.
3. Keep both windows visible for the whole test. Browsers slow the timers of hidden or
   minimised windows, which can start a false leave countdown (design.md section 6).

Call the left window **A** (it creates the room and is the host) and the right window
**B** (it joins).

- [ ] Both windows show the lobby, scaled to fit the window with sharp (pixelated) edges.

## 4. Create and join a room

### 4.1 Join errors (window B)

- [ ] Click Join Room. The Join Room screen shows a code box, a Join button and Back.
- [ ] Press Join with the box empty: the error "Enter a room code." shows.
- [ ] Type `AB0O1` and press Join: the error "Room codes are 5 letters and digits
      (no 0, O, 1 or I)." shows.
- [ ] Type `ABCDE` (no room has this code) and press Join: "Looking for room ABCDE..."
      shows, then after about 3 seconds "No room found with code ABCDE." shows.
- [ ] Press Back (or Esc): you are back in the lobby.

### 4.2 Create the room (window A)

- [ ] Click Create Room. The screen asks you to pick Wind Rabbit (X stones, moves first)
      or Earth Bear (O stones).
- [ ] Press Back, then Create Room again: the choice screen comes back.
- [ ] Pick **Wind Rabbit**. The Waiting screen shows a 5 character room code (only
      capital letters and digits, never 0, O, 1 or I), a Copy button, the text
      "Waiting for opponent" and "You play Wind Rabbit."
- [ ] Press Copy: "Copied!" shows for a moment.

### 4.3 Join the room (window B)

- [ ] Click Join Room, paste the code (Ctrl+V), and press Join. Lower case and spaces
      are fine: `ab cde` works the same as `ABCDE`.
- [ ] Both windows switch to the game screen at once.
- [ ] Window A's top line says "Room CODE | You play Wind Rabbit (X)"; window B's says
      "... You play Earth Bear (O)". The joiner got the other character.
- [ ] The Wind Rabbit panel is on the left and the Earth Bear panel on the right in both
      windows. Each panel shows a portrait (placeholder square with a letter), the name,
      "Stone: X" or "Stone: O", and two skill buttons with an icon, the name and "Ready".
- [ ] Only your own panel has the green "You" tag (left in A, right in B).
- [ ] The Wind Rabbit panel has the yellow turn highlight and "Taking a turn". The status
      line under the board says "Your turn" in A and "Opponent's turn" in B.

### 4.4 Full room (a third window)

- [ ] Open a third window (Ctrl+N), go to http://localhost:8000, Join Room with the same
      code: the error "Room CODE is full." shows. Close the third window. The game in
      A and B goes on without a countdown.

## 5. Basic play

- [ ] In A, move the mouse over the board: the cell under the pointer lights up with a
      faint X stone. Click (8, 8): a blue disc appears in both windows, with sparkles, a
      dust puff and a light screen shake.
- [ ] In A, click another cell now: "It is your opponent's turn." shows and nothing is
      placed.
- [ ] In B, click (8, 8) (taken): "That cell is not empty." shows. Click (9, 9): a red
      disc appears in both windows. The turn highlight moves each turn.
- [ ] In B, click one of Wind Rabbit's skill buttons: "That is your opponent's skill."
- [ ] Right-click or Esc does nothing harmful when no skill is being targeted.
- [ ] Faint wind streaks drift left to right across the scene all the time.

## 6. Skills checklist

Cooldowns count only the owner's own turns. After a player uses a skill:

- short cooldown (Wind Dash, Terrain Creation): the button shows "Locked: 3 turns" with a
  grey overlay and a big 3 on the icon, and stays locked for that player's next 3 turns
  (3, 2, 1). It is Ready again on their 4th turn after using it.
- long cooldown (Tornado Zone, Stone Conversion): the same with 6.

Using a skill uses your whole turn. For every skill check that:

- the skill banner (for example "Wind Dash!") shows in both windows,
- the turn passes to the opponent,
- both windows show the same board afterwards,
- the other player's window shows the skill's marker or result too.

Targeting in general:

- [ ] Clicking a Ready skill button on your turn makes it "Choosing..." with a yellow
      border and the status line shows what to pick.
- [ ] Clicking the same button again, pressing Esc, or right-clicking cancels it.
- [ ] Clicking a locked button shows "SKILL is locked for N more turns." and does nothing
      else.
- [ ] Clicking a skill button when it is not your turn shows "It is your opponent's
      turn."

### 6.1 Wind Dash (Wind Rabbit, short cooldown)

Play a few normal moves first so Wind Rabbit has some stones on the board.

- [ ] A clicks Wind Dash: "Wind Dash: choose one of your stones". Clicking an empty cell
      or an O stone shows "Choose one of your own stones."
- [ ] A clicks one of its X stones: it gets a pale blue whirl and the status says
      "Wind Dash: choose an empty target cell". Hovering empty cells shows a red frame.
      Clicking a taken cell shows "Choose an empty target cell." Clicking another X stone
      picks that one instead; clicking the chosen stone again un-picks it.
- [ ] A clicks an empty target: the banner "Wind Dash!" shows. **Nothing moves yet.** In
      both windows the target cell has a red translucent frame and the source stone a
      whirl. The message says "Wind Dash! The stone dashes after the next turn."
- [ ] Wind Dash is now locked for 3 of A's turns.

Resolve cases (announce a new dash each time the cooldown allows):

- [ ] **Lands:** B places a stone somewhere else. When B's turn ends the X stone moves
      from the source to the target in both windows, the source cell is empty, and
      "Wind Dash landed!" shows.
- [ ] **Lands after a skill turn:** B uses a skill (for example Terrain Creation on
      another cell) instead of placing. The dash still lands at the end of that turn.
- [ ] **Target taken:** B places an O stone on the red-framed target. The dash fails
      ("Wind Dash failed: the target cell is taken."), the X stone stays, and Wind Dash is
      still locked.
- [ ] **Rock on target:** B uses Terrain Creation on the target. The dash fails the same
      way.
- [ ] **Source converted:** B uses Stone Conversion on the source stone. It turns into an
      O stone and the dash fails ("Wind Dash failed: the stone is gone.").
- [ ] **Dash wins:** set up four X stones in a row with the fifth cell empty, then dash
      another X stone into that cell. After B's next turn the dash lands, the five are
      outlined in yellow, and A wins (see section 7).
- [ ] **Opponent wins first:** while a dash is announced, B completes five O stones. B
      wins at once, the dash never happens, and the red frame and whirl are gone from the
      final board.

### 6.2 Tornado Zone (Wind Rabbit, long cooldown)

- [ ] A clicks Tornado Zone: "Tornado Zone: choose the zone centre". Hovering shows a 3x3
      translucent swirl. Any cell can be the centre, even a taken one.
- [ ] A picks a centre in the middle of the board: in both windows the 3x3 zone shows a
      swirling overlay with a dashed edge, the banner "Tornado Zone!" and the message
      "Tornado Zone! It lasts through the next turn." Tornado Zone is locked for 6 turns.
- [ ] **Edge clipping:** on a later use, pick a corner cell such as (1, 1): the zone
      covers only the 2x2 cells on the board. A centre on an edge (not a corner) covers
      2x3 cells.
- [ ] **Throw:** B places an O stone inside the zone. It is thrown to one of the empty
      cells next to where it was placed ("Whoosh!", "The tornado threw the stone!"). Both
      windows show it in the **same** cell, because only the host picks the random cell.
- [ ] **Only empty neighbours:** the stone never lands on a stone, a rock or off the
      board. Try placing on a zone cell at the board edge, next to stones and rocks.
- [ ] **Nowhere to go:** B places inside the zone on a cell whose neighbours are all
      stones, rocks or off the board (a corner cell with its 3 neighbours filled is the
      easiest). The stone stays: "The tornado had nowhere to throw the stone."
- [ ] **Outside the zone:** B places outside the zone: the stone is not thrown.
- [ ] **One turn only:** after B's turn (placing or using a skill) the overlay is gone. On
      B's next turn, stones placed in the old zone stay.
- [ ] **Skills are not thrown:** B uses Terrain Creation or Stone Conversion inside the
      zone: nothing is thrown.
- [ ] **Throw wins:** a stone thrown into a spot that makes five O stones wins for B.
- [ ] **Throw spoils a win:** B completes five inside the zone but the stone is thrown
      away: no win, the game goes on.
- [ ] **Stuck stone still wins:** if the stone cannot be thrown and makes five where it
      was placed, B wins.

### 6.3 Terrain Creation (Earth Bear, short cooldown)

- [ ] B clicks Terrain Creation: "Terrain Creation: choose an empty cell". Hovering an
      empty cell shows a faint rock. Clicking a stone shows "Choose an empty cell."
- [ ] B picks an empty cell: a grey square rock appears at once in both windows, with
      dust and a light screen shake. "Terrain Creation! A rock fell." Terrain Creation is
      locked for 3 turns.
- [ ] **Blocks placing:** clicking the rock (either player, on their turn) shows "That
      cell is not empty." A skill cannot target it: Wind Dash to it, Stone Conversion on
      it and another Terrain Creation on it are all refused.
- [ ] **Breaks lines:** X X rock X X in a row is not a win for anyone.
- [ ] **Lifetime:** count the turns after the rock fell: A, B, A, B. The rock stays through
      all four and crumbles (dust, "A rock crumbled.") at the end of the fourth, that is
      when B's second turn after dropping it ends. The cell is then empty and can be used.
- [ ] **Blocks the tornado throw:** a stone thrown by the tornado never lands on a rock.

### 6.4 Stone Conversion (Earth Bear, long cooldown)

- [ ] B clicks Stone Conversion: "Stone Conversion: choose an opponent's stone". Clicking
      an empty cell, a rock or an O stone shows "Choose one of your opponent's stones."
- [ ] B picks an X stone: it turns into an O stone at once in both windows, with sparkles.
      "Stone Conversion! The stone changed sides." Stone Conversion is locked for 6 turns.
- [ ] **Conversion wins:** with O O _ O O in a row and an X stone in the gap, converting
      that X stone gives five and B wins at once.
- [ ] **Pending dash:** converting the source stone of an announced Wind Dash makes the
      dash fail (see 6.1).

## 7. Game over

- [ ] When a player makes five or more in a row, the winning stones are outlined in
      yellow, the winner's panel says "WINNER!", and the status line shows the result.
      About 1.5 seconds later both windows show the Game over screen: "You win!" in the
      winner's window and "You lose." in the other, with "NAME made five in a row."
- [ ] Six in a row also wins.
- [ ] Press Back to Lobby in both windows: both return to the lobby.
- [ ] Create and join a new room with A picking **Earth Bear** this time. B gets Wind
      Rabbit and moves first; the panels stay Wind Rabbit left and Earth Bear right, and
      the "You" tag is on the right in A.

## 8. Disconnect test

Start a fresh room for each case and play a few moves first.

- [ ] **Guest closes:** close window B. Within a moment A's status line shows "Opponent
      left. You win in 10" and counts down to 1. At 0, A shows the Game over screen with
      "Opponent left, you win!".
- [ ] **Host closes:** close window A instead. B counts down the same way and wins.
- [ ] **Reload:** reloading a window counts as leaving: the other window counts down and
      wins. The reloaded window is back in the lobby.
- [ ] **Silence, then back:** in window B open DevTools, go to Sources and press Pause
      (F8) to freeze the page. About 3 seconds later A starts the countdown. Resume (F8)
      in B before it reaches 0: the countdown stops in A and the game goes on normally.
- [ ] **Silence to the end:** pause B again and let A's countdown reach 0: A wins. Resume
      B: after a moment it takes the host's result and shows "You left, you lose."
- [ ] **During skill targeting:** start a skill's target flow in A, then close B. The
      countdown shows on the status line and the targeting prompt stays on the message
      line. At 0 the Game over screen shows as usual.
- [ ] **After the game ended:** finish a game by five in a row, then close one window on
      the Game over screen. The other window keeps its result; nobody gets a second win.
- [ ] **Waiting room:** in the Waiting screen press Cancel (or close A). Joining that code
      from B now gives "No room found with code CODE."

## 9. Local dev mode (optional)

- [ ] Open http://localhost:8000/?local=1. One window plays both sides; the "You" tag is on
      the panel of the player to move. All the skill checks in section 6 can be repeated
      here without a room. Press R to restart.
