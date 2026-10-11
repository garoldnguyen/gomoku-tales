# Gomoku Tales: Manual Test (two windows)

A step-by-step check of online play in two browser windows, the skills of the four
characters (Free Action) and the disconnect handling. The rules are in [design.md](design.md); the unit tests
(`node --test`) cover the rules in detail, so this test focuses on what you see
and what reaches the other window.

Online play draws the game in the HD-2D 3D world by default
([art-direction-hd2d.md](art-direction-hd2d.md)): pieces, rocks, characters and skill
visuals are 3D, and the HUD and the lobby and room screens are 2D layers above it. Where
this guide names a look, the 3D look comes first and the old 2D look follows in brackets;
the 2D game is still reachable with `?render=2d` (see section 10.6). Section 10 holds the
checks that only the 3D renderer needs.

Tick each box as you go. If a step fails, note the step, what you did and what you saw.

Cells are named (column, row) counted from the top-left corner, starting at 1. For
example (8, 8) is the centre of the 15x15 board.

## 1. Before you start

- [ ] Run the unit tests from the project root: `node --test`. All tests pass.
- [ ] Use Chrome (or another Chromium browser) in a normal profile. Served by
      `python3 -m http.server` there is no relay, so this guide opens the game with
      `?transport=broadcast`: rooms then link windows through a BroadcastChannel, which only
      works inside one browser profile (do not use Incognito or a guest window for only one
      of the two windows). Over the relay (docs/deploy.md) two computers work too.

## 2. Start the server

1. Open a terminal in the project root (the folder with `index.html`).
2. Run:

   ```sh
   python3 -m http.server 8000
   ```

3. Leave the terminal open. It prints a line for every file the browser loads.

- [ ] Open http://localhost:8000/?transport=broadcast in Chrome. The menu shows over the 3D
      farm scene with the buttons Play Online, Play on this computer, Watch a match, How
      to Play and Settings. Play Online opens the lobby with Create Room and Join Room.
- [ ] Open DevTools (F12) and check the Console. There are no script errors. A "404 (File
      not found)" line for each missing art file is expected while `assets/` holds only
      `manifest.json`; placeholders are drawn instead.

## 3. Open two windows side by side

1. In the first window press Ctrl+N (Cmd+N on macOS) to open a second window of the same
   profile, and open http://localhost:8000/?transport=broadcast in it. Use a new window,
   not a new tab, so both stay visible.
2. Put the windows side by side: on Windows press Win+Left in one and Win+Right in the
   other; on macOS or Linux drag them to the two halves of the screen.
3. Keep both windows visible for the whole test. Browsers slow the timers of hidden or
   minimised windows, which can start a false leave countdown (design.md section 6).

Call the left window **A** (it creates the room and is the host) and the right window
**B** (it joins).

- [ ] Both windows show the menu over the 3D scene, which fills the whole window. Each
      window has its own quality switch (Q key).

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

- [ ] Click Play Online, then Create Room. The room is made at once, with no character
      choice here: the Waiting screen shows a 5 character room code (only capital letters
      and digits, never 0, O, 1 or I), a Copy button and the text "Waiting for opponent".
- [ ] Press Copy: "Copied!" shows for a moment.
- [ ] Press Leave: you are back at the menu and the room is closed. Create a room again.

### 4.3 Join the room and pick the characters (window B)

- [ ] In window B click Play Online, then Join Room, paste the code (Ctrl+V), and press
      Join. Lower case and spaces are fine: `ab cde` works the same as `ABCDE`.
- [ ] Both windows switch to the character select ("Pick your character") with four
      cards: Wind Rabbit, Earth Bear, Jade Serpent and Cloud Eagle, each with its two
      skills and rest turns. Each window shows both seats and Ready.
- [ ] A picks Wind Rabbit: in B that card is now disabled and says Taken. B picks Earth
      Bear. Both press Ready (a press on Ready reads Unready until the other is ready).
- [ ] Both windows enter the game at the same moment. The first pick (A, Wind Rabbit)
      plays X and moves first. A character card is never tied to X or O: the first pick
      plays X whichever character it is.
- [ ] The X card is on the left and the O card on the right in both windows, with the
      board between them. In 3D the cards are quiet glass cards (docs/art-direction-v3.md
      section 8), each with the portrait, the name, "Plays X" or "Plays O" with the
      planted count, a status chip and two skill rows with an icon, the name and "Ready".
- [ ] Only your own card has the "You" tag (left in A, right in B).
- [ ] The X card has the turn highlight and "Your turn" in A, and "Waiting" in B. The turn
      pill says "Plant a seed" in A and "Opponent's turn" in B.

### 4.4 Full room (a third window)

- [ ] Open a third window (Ctrl+N), go to http://localhost:8000/?transport=broadcast,
      Play Online, Join Room with the same code: the error "Room CODE is full." shows. Close the third window. The game in
      A and B goes on without a countdown.

## 5. Basic play

- [ ] In A, move the mouse over the board: the cell under the pointer lights up with a
      faint X stone. Click (8, 8): an X stone (a sprout that pops in; 2D: a blue disc)
      appears in both windows, with sparkles, a dust puff and a light screen shake.
- [ ] In A, click another cell now: "It is your opponent's turn." shows and nothing is
      placed.
- [ ] In B, click (8, 8) (taken): "That cell is not empty." shows. Click (9, 9): an O
      stone (a flower bud; 2D: a red disc) appears in both windows. The turn highlight moves each turn.
- [ ] In B, click one of Wind Rabbit's skill buttons: "That is your opponent's skill."
- [ ] Right-click or Esc does nothing harmful when no skill is being targeted.
- [ ] 3D: no straight wind streak lines anywhere; on High, petals and leaves drift from the
      upper left toward the lower right. [2D: faint wind streaks drift left to right.]

## 6. Skills checklist (Free Action)

A skill does not use the turn (docs/design.md section 4, docs/free-action-design.md). On your turn you may use at most one skill that is ready, and then you MUST plant a seed: planting is the only thing that ends the turn. Cooldowns count only the owner's own turns and start at once when the skill is used:

- short cooldown (Wind Dash, Mud Trap, Hiss): right after the skill is used its row shows "Ready in 3 turns" with a cooling ring and a big 3 on the icon. It stays that way for the owner's next 3 turns (3, 2, 1) and is Ready again on the 4th turn after.
- long cooldown (Tornado Zone, Petrification, Venom, Cloud): the same with 6.

Sky Watch is passive: it shows "Always on", is never clicked and has no cooldown.

To meet every skill, play two rooms: the first with A = Wind Rabbit and B = Earth Bear (sections 6.1 to 6.4), the second with A = Jade Serpent and B = Cloud Eagle (sections 6.5 to 6.7). In each room pick in the character select and press Ready in both windows. The first pick plays X. The same checks can be repeated in `?local=1` (section 9).

### 6.0 The Free Action turn

- [ ] A uses a ready skill (any, with a legal target): A is still to move. A's turn pill, the status line and the banner say "Now plant a seed to end your turn." and B's window does not start B's turn yet.
- [ ] A's card flashes the colour of A's character on its border for a moment, in both windows (Wind Rabbit blue, Earth Bear ochre red, Jade Serpent jade green, Venom deep purple, Cloud Eagle pale yellow).
- [ ] The other skill row of A reads "Already used a skill this turn." and clicking it shows "You already used a skill this turn." The skill that was used shows its full cooldown (3 or 6) at once.
- [ ] A refused skill (a wrong target, for example an own plant for Petrification) uses nothing: A may pick again, the cooldown and the one skill of the turn are still free.
- [ ] There is no way to end the turn without planting: no pass button, and the turn does not move on until A plants a seed.
- [ ] A plants a seed: the turn passes to B. The skill A used keeps its full cooldown through that turn end and counts down at the end of each of A's later turns (3, 2, 1, Ready).
- [ ] A cannot use a skill after planting (it is B's turn: "It is not your turn." / the rows are disabled).
- [ ] A skill never wins or ends a game on its own, only a planting, a landing dash, a thrown seed or a surfacing seed can.
- [ ] Clicking a skill row that cannot be used explains why in the status line: the cooldown ("Wind Dash is on cooldown for 2 more turns."), "You already used a skill this turn.", "Hiss: you cannot use a skill this turn.", or "It is not your turn." Clicking a Ready skill again, pressing Esc or right-clicking cancels the target step.

For every skill also check that the other window shows the same board afterwards and that nothing you were not allowed to see was shown (the secret cross, a covered plot).

### 6.1 Wind Dash (Wind Rabbit, short cooldown)

Play a few normal moves first so Wind Rabbit has some plants on the board.

- [ ] A clicks Wind Dash: the prompt asks for one of A's plants. Clicking an empty plot or an O plant shows "Choose one of your own stones." A seed sunk in mud (6.3) shows "That plant is sunk in mud."
- [ ] A clicks one of its X plants: it gets a pale blue whirl. Hovering plots shows a red frame on the target. Clicking another X plant picks that one instead; clicking the chosen plant again un-picks it.
- [ ] **Range:** a target within 3 plots of the source in any direction, diagonals included (a 7 by 7 square around it), is accepted. A target 4 plots away shows "That cell is too far for Wind Dash." A taken plot shows "The target cell is not empty." A mud plot shows "A Wind Dash cannot land on mud." A poisoned plot (6.6) shows "A Wind Dash cannot land on poison."
- [ ] A clicks a legal empty target: **nothing moves yet.** In both windows the target has a red translucent frame and the source plant a whirl. A must still plant a seed to end the turn.
- [ ] Wind Dash now shows its cooldown, 3 turns.

Resolve cases (announce a new dash each time the cooldown allows):

- [ ] **Lands:** B plants somewhere else. When B's turn ends the X plant folds into a seed, flies in an arc and sprouts on the target in both windows, the source plot is empty and the win check runs.
- [ ] **Lands after a skill turn:** B uses a skill and then plants. The dash lands at the end of that turn.
- [ ] **Target taken:** B plants on the red-framed target. The dash fails, the X plant stays and Wind Dash keeps its cooldown.
- [ ] **Mud on target:** B uses Mud Trap on the target (it is empty) and plants elsewhere. The dash fails the same way.
- [ ] **Source petrified:** B uses Petrification on the source plant and plants. The plant is a rock, the dash fails (it has no source any more).
- [ ] **Dash wins:** set up four X plants in a row with the fifth plot empty, then dash another X plant into that plot. After B's next turn the dash lands, the five are marked, and A wins (see section 7).
- [ ] **Opponent wins first:** while a dash is announced, B completes five O plants. B wins at once, the dash never happens, and the red frame and whirl are gone from the final board.

### 6.2 Tornado Zone (Wind Rabbit, long cooldown): the secret cross trap

- [ ] A clicks Tornado Zone: the prompt says "Tornado Zone: choose the trap centre". Hovering shows a cross of 5 plots (the centre and the four plots up, down, left and right). Any plot can be the centre, even a taken one.
- [ ] A picks a centre in the middle of the board: **in A's window** faint blue petals and a cross mark drift over the 5 plots. **In B's window nothing at all shows on the board**: only the banner "Wind Rabbit placed a trap!" and A's card flash. B's window never shows the cross while the trap waits (check the state again after each turn).
- [ ] **Edge clipping:** on a later use, pick a corner plot such as (1, 1): the cross covers only 3 plots. A centre on an edge (not a corner) covers 4.
- [ ] **Armed at once:** A casts and then plants a seed on one of the cross plots in the same turn: the trap fires at once (the cross is revealed in both windows and A's seed is thrown to a random plot). A seed planted off the cross in the cast turn does not fire it.
- [ ] **Fire:** on B's next turn (or A's following turn) a seed planted on a plot of the cross, by either player, fires the trap at once: the cross is revealed in both windows as a whirlwind, the seed spins up and is thrown in a long arc to a random free plot anywhere on the field (the same plot in both windows, because only the host picks), with a small dust puff, then it sprouts. Throw several times: the landing plots are all over the field, not next to the cross. The trap is used up: a second seed on the cross is not thrown.
- [ ] **Only free plots:** the seed never lands on a taken plot, a rock, a mud plot or a poisoned plot.
- [ ] **Nowhere to go:** when no plot of the board is free (all taken, rocks, mud or poisoned) the seed stays ("throw blocked", only the whirlwind plays).
- [ ] **Nobody fires it:** after 2 turns (B's, then A's) the trap ends with no reveal and no visual in B's window.
- [ ] **Outside the cross:** a seed planted outside the cross is never thrown. Skills are not thrown.
- [ ] **Throw wins:** a seed thrown to a spot that makes five wins for its planter. **Throw spoils a win:** five completed on the cross but the seed is thrown away: no win, the game goes on.

### 6.3 Mud Trap (Earth Bear, short cooldown)

- [ ] B clicks Mud Trap: the prompt asks for a plot. A taken plot is refused ("That cell is not empty."), a mud plot "That cell is already mud." and a poisoned plot "That cell is poisoned."
- [ ] B picks an empty plot: a bubbling brown mud puddle spreads out on it in both windows. B still plants a seed.
- [ ] **The sinking seed:** either player plants on the puddle (B too, in the same turn): the seed lands, sinks below the ground (the plant drawn pushed down and dim) and the puddle is used up. The sunk seed counts for no row: four plants and a sunk fifth do not win.
- [ ] **Surfacing:** at the end of the next turn (the opponent's turn after the planting) the mud dries and cracks and the sprout pops up in both windows. It counts normally from now on, and if it completes five, its owner wins at that moment (even though the other player acted).
- [ ] **Both complete five:** if the acting player completes five in the same turn as the opponent's seed surfaces into five, the acting player wins.
- [ ] **A puddle nobody uses** dries and cracks at the end of the 4th turn after the cast turn (the opponent, the caster, the opponent, the caster).
- [ ] A sunk seed cannot be the source of a Wind Dash or the target of Petrification ("That plant is sunk in mud."). Venom may target it (6.6).
- [ ] A Wind Dash cannot land on mud and a Tornado throw never lands on mud (see 6.1 and 6.2).
- [ ] **Draw edge:** if the last empty plot is mud and gets planted the board is full, the seed surfaces at once in the same turn (win check for its owner) and only then the draw is decided if nobody has five.

### 6.4 Petrification (Earth Bear, long cooldown)

- [ ] B clicks Petrification: "choose an opponent's plant". Clicking an empty plot, a rock, one of B's own plants or a seed sunk in mud is refused ("Choose one of your opponent's stones." / "That plant is sunk in mud."), using no turn and no cooldown.
- [ ] B picks an X plant: B's card shakes slightly and puffs gold and green dust. In both windows the plant is wrapped in gold energy from below, turns grey, shatters and becomes a mossy rock with dust rising and a light shake. B still plants a seed.
- [ ] **Permanent:** the rock never breaks, however many turns pass. Nobody can plant, dash or throw onto it, and no skill can target it.
- [ ] **Breaks lines:** X X rock X X in a row is not a win for anyone.
- [ ] **Pending dash:** petrifying the source plant of an announced Wind Dash makes the dash fail (see 6.1).

### 6.5 Hiss (Jade Serpent, short cooldown)

- [ ] J clicks Hiss (no target needed): J's card glows and a purple sonic wave crosses to the opponent's card, which shakes lightly. Jade sound rings cross the field.
- [ ] The opponent's card shows a red blinking lock rune with "Locked: 1 turn" and its skill icons dim to grey (about 40 percent). The opponent may still plant. J must still plant too.
- [ ] On the opponent's turn every skill row is disabled; clicking one shows "Hiss: you cannot use a skill this turn."
- [ ] The lock ends when the opponent's turn ends and the rune is gone. Casting Hiss does not change any cooldown, but the locked turn ends like any turn: the opponent's running cooldowns count down by 1 after their planting (a skill at 2 reads 1).
- [ ] If the game ends on the locked turn, the lock is dropped.

### 6.6 Venom (Jade Serpent, long cooldown)

- [ ] J clicks Venom: "choose an opponent's plant". Hovering a plant shows a 3 by 3 purple preview. An empty plot, a rock, J's own plant is refused. A seed sunk in mud may be chosen.
- [ ] J picks an O plant: a deep purple card flash, venom sap drops fall on the plant, it droops a little and stays on the board. The empty plots of the 3 by 3 square (clipped at the edges) turn withered purple with low fog and toxic bubbles hugging the ground. Both windows show it. J still plants a seed (not on a poisoned plot).
- [ ] **Poisoned plots:** nobody (J too) can plant on an empty poisoned plot: "That cell is poisoned." Hovering one shows a red crossed-out border. A Wind Dash, a Mud Trap or a Tornado throw cannot reach it. Plants already inside stay and keep counting for their row.
- [ ] **Duration:** the zone lasts through the opponent's next turn and J's next turn, then thins away (fog and bubbles fade) after the end of that second turn.
- [ ] **No room:** Venom is refused with "There would be no room left to plant." when the zone would leave no empty unpoisoned plot on the board. A lasting zone that would leave the next player no plot to plant on ends early.

### 6.7 Cloud and Sky Watch (Cloud Eagle)

- [ ] E clicks Cloud: "choose where the cloud goes". Hovering shows a faint 4 by 4 cloud under the pointer: it reaches 1 plot up and left of the plot and 2 plots down and right of it (the clicked plot is the upper left of the middle 2 by 2), cut at the board edge.
- [ ] E picks a plot (a card flash in pale yellow, white feathers float out of E's card). **E's window (and a spectator):** a translucent cloud with everything under it visible. **The opponent's window:** a dense, almost opaque cloud with now and then a flash of lightning, and a small cloud puff on every taken plot (never showing whose plant or a rock). The empty plots under it take a seed as usual.
- [ ] Look at both windows at once from both seats: the opponent never learns what is under the cloud, E sees all.
- [ ] A skill target on a covered plot is refused for the opponent: "That cell is under a cloud." A seed on a taken covered plot: "That cell is not empty."
- [ ] A mud puddle (and a seed sunk in mud) on a plot under the cloud is hidden from the opponent, who sees only the cloud and the puff on a taken plot; E and a spectator still see it. The poison zone itself is public, but its plots under the cloud are not drawn for the opponent (no withered soil, fog or bubble there); the cloud owner and a spectator still see them.
- [ ] After E's next 2 turns the cloud thins away and the plots show again.
- [ ] Sky Watch (E's side and spectators only): every empty plot where the opponent would make 4 or more in a row with one more plant glows pale yellow with an outline and a drifting cloud; a sunk seed counts for nobody; never shown for the opponent, under their cloud, or after the game is over.

## 7. Game over

- [ ] When a player makes five or more in a row, the winning plants are marked (each sends
      a ring and twinkles in the winner's colour, one after another) and the winner's card
      says Winner. The Game over card shows at the top centre, so the finished board stays
      visible: "You win" in the winner's window and "You lose" in the other, with the
      winning character.
- [ ] Six in a row also wins.
- [ ] A win by a sunk seed that surfaced, a landing Wind Dash or a thrown seed ends the game
      the same way (see sections 6.1 to 6.3).
- [ ] Press Rematch in both windows: a clean board starts with the same characters on the
      same sides, X first, and no mud, rock, zone, cloud or cooldown is left over. Press
      Back to Menu in both windows: both return to the menu.
- [ ] Create and join a new room, this time with B picking first (**Earth Bear**) and A
      second (**Wind Rabbit**). B plays X and moves first; the X card (Earth Bear) is on the
      left in both windows and the "You" tag is on the right in A.

## 8. Disconnect test

Start a fresh room for each case and play a few moves first.

- [ ] **Guest closes:** close window B. Within a moment A's status line shows "Opponent
      left. You win in 10" and counts down to 1. At 0, A shows the Game over screen with
      "Opponent left, you win!".
- [ ] **Host closes:** close window A instead. B counts down the same way and wins.
- [ ] **Reload:** reloading a window counts as leaving: the other window counts down and
      wins. The reloaded window is back at the menu.
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
- [ ] **Waiting room:** in the Waiting screen press Leave (or close A). Joining that code
      from B now gives "No room found with code CODE."

## 9. Local dev mode (optional)

- [ ] Open http://localhost:8000/?local=1. One window plays both sides: first the character
      select for Player 1 and Player 2 (each picks, both press Ready), then the game. The
      "You" tag is not shown. All the skill checks in section 6 can be repeated
      here without a room (the secret Tornado cross shows while its caster is still to move and is gone once the turn passes to the other player). Press R to restart.

## 10. 3D checks (two WebGL windows)

The unit tests cannot see the 3D scene, so check these by eye. Use the two windows A and B
from section 3, side by side and both visible.

The short Farmland v3 checklist for the owner (the look on each quality level, plant
growth, clouds, flowers, glass cards, skills and a clean console) is docs/visual-qa.md.

### 10.1 Both windows draw the scene

- [ ] Both windows show the 3D scene at the same time, each with its own FPS counter
      moving in the top-left corner. Neither window turns black, freezes or falls back to
      the flat 2D board.
- [ ] DevTools Console in both windows: no WebGL errors and no "Too many active WebGL
      contexts" or "WebGL context lost" warnings.
- [ ] Pixels stay crisp in both windows: the sprites, the board grid and the HUD text have
      hard pixel edges, and nothing shimmers while the scene idles.

### 10.2 Screens over the scene

- [ ] Lobby, Create Room, Join Room and Waiting are dark glass cards above the 3D scene. On
      medium and high the scene behind them is blurred; on low it is sharp (the blur is
      skipped to save GPU time). The title and the quality line are never blurred, and no
      dark fringe shows at the edges of the blurred scene.
- [ ] The scene behind the screens shows an empty field, and on High the clouds drifting
      and the wind petals moving.
- [ ] Game over: the card shows over a dimmed but sharp scene, with the final board, the
      yellow winning line and the winner's and loser's poses in view.
- [ ] Back to Lobby: the board behind the lobby is empty again, the characters idle and no
      skill marks or effects are left over. A new game starts from a clean board.

### 10.3 Quality is per window

The levels (the README has the full table, src/render3d/quality.js has the switches):
high has depth of field, bloom, a vignette, real sun shadows, drifting clouds and wind;
medium (the default) has no post effects and no blur at all, blob shadows and still
clouds; low has no shadows, no scenery, flowers, hills or clouds and no effect particles.

- [ ] In A press Q until it shows high: distant hills and sky are soft, the board centre
      is sharp, the trees and the board cast soft sun shadows on the grass, the corners are
      a little darker and the white rabbit and the hover glow have a faint bloom.
- [ ] medium: everything is sharp, no vignette; no sun shadows, only the blobs under the
      sprites; the clouds stand still and the wind petals are gone.
- [ ] low: no shadows, trees, flowers, hills or clouds; placing a stone or using a skill
      shows no particles and no screen shake; colours look about the same as on medium.
- [ ] Switching level in the middle of a game keeps every stone, rock, cooldown and the
      turn exactly as they were.
- [ ] On every level the pieces, characters and board grid keep hard pixel edges, and a
      level change hitches at most once.
- [ ] Press Q in A (click A's scene first so it has focus): A's level goes medium -> low ->
      high -> medium, and B's stays as it was. Then press Q in B: only B changes.
- [ ] Leave A on high and B on low and play a few moves: both keep their level and draw the
      same board.
- [ ] On the Join Room screen, type a code with a Q in it (for example `QWERT`): the letter
      goes into the box and the quality level does not change.
- [ ] Reload a window (this leaves any room): it starts on the level last chosen with Q
      in either window (the choice is saved per site), or medium if none was. The other
      window keeps its level until it reloads.
- [ ] Open `http://localhost:8000/?quality=low`: it starts on low and remembers it. With
      `?quality=banana` it starts on medium. With storage blocked (private window with
      site data blocked) the game still starts and Q still works.

### 10.4 Resize and pixel ratio

- [ ] Drag the edge of A to make it narrow and tall, then wide and short: the scene keeps
      16:9 with dark bars, stays sharp (not stretched or blurry), and B is not affected.
- [ ] After resizing, hover the board in A: the highlight is on the cell under the pointer,
      including the corner cells (1, 1) and (15, 15).
- [ ] Zoom A with Ctrl+Plus and Ctrl+Minus, then Ctrl+0: the scene re-renders sharp at
      each zoom step and picking still hits the right cell.
- [ ] If you have two screens with different scaling (for example a laptop at 150% and a
      monitor at 100%), drag A from one screen to the other: the scene is sharp on both
      without resizing the window.

### 10.5 Hidden windows

Hidden tabs get no animation frames, but the room keeps running on timers.

- [ ] Start a game. On A's turn, open a new tab in B (Ctrl+T) so B's game tab is hidden.
      In A, place a stone. Wait about 10 seconds, then close the new tab in B: B's board
      shows A's stone at once, and A never showed a leave countdown.
- [ ] Hide B again on A's turn and in A announce a Wind Dash (or use Mud Trap or Venom).
      Show B again: the red frame and the whirl (or the puddle, or the poisoned plots) are
      there at once, without a burst of old sparkles, a stack of old banners, or a camera
      shake. A Tornado Zone cast meanwhile shows nothing in B's window.
- [ ] While B was hidden, its FPS counter did not drop to a tiny number when it came back,
      and its quality did not step down to "(auto)".
- [ ] Minimise A for a few seconds and restore it: the same holds for A.

### 10.6 The 2D renderer still works

- [ ] Open http://localhost:8000/?render=2d in two windows and play a few moves and one
      skill: the flat 2D board works online as before, with no quality line and no blur.
      Pressing Q does nothing.
- [ ] Open http://localhost:8000/?render=2d&local=1: local mode works in 2D too.

### 10.7 Slow frames step down

- [ ] Only a browser with no saved choice steps down: first clear the saved level
      (DevTools, Application, Local Storage, delete the quality key). A level picked by
      hand (Q, the HUD switch, Settings) is never changed by the game, however slow.
- [ ] Make A slow: put it on high on a weak laptop, or in DevTools open the Performance
      tab, click the gear icon and set CPU to "6x slowdown" (if that is not enough to drop
      the FPS, also make the window full screen on a large monitor). Whenever the FPS stays
      below about 50 for 3 seconds, the corner shows the next lower level with "(auto)";
      it steps one level at a time and never below low. A short hitch (a shader compile,
      switching tabs) does not step down. Turn the slowdown off: the level stays where it
      is until you press Q, which clears "(auto)".

### 10.8 The look lab

- [ ] Open http://localhost:8000/hd2d-lab.html. It shows the same Breeze Hill scene with a
      few sample stones and a rock, and "Quality medium [Q]", the FPS and the hovered cell
      in the top-left corner. Q cycles the levels as in 10.3, and the hover glow follows the
      pointer. [docs/lab.md](lab.md) lists what to look at.

