# Visual QA checklist (Farmland v3)

For the game's owner, after the last Farmland v3 task. Tests cannot judge how
the scene looks, so this is checked by eye in a browser. The checklist is
copied from docs/art-direction-v3.md section 11; that section stays the
source of truth.

## How to open the game

1. In the project folder run `python3 -m http.server 8000`.
2. Open `http://localhost:8000/?local=1&quality=low`, then
   `quality=medium`, then `quality=high` (or press Q in the game to step
   through the levels). `?local=1` lets one window play both sides.
3. Open the browser's developer console (F12) before loading each level.
4. Compare each level with `docs/reference/v3/scene-low.jpg`,
   `scene-medium.jpg` and `scene-high.jpg`, and the HUD with
   `docs/reference/v3/hud-quality.png`.

For the online screens, open `http://localhost:8000/` in two windows of the
same browser profile (see docs/testing.md).

## Checklist

1. [ ] Low, Medium and High look clearly different and each matches its `scene-*.jpg` in spirit.
2. [ ] Plant a seed: it drops, lands, sprouts and opens in about 1.2 seconds, X is a four-petal cross bloom and O a round bloom, in the colour of the character that plays it.
3. [ ] Five in a row: the winning plants show the gold sparkle mark.
4. [ ] Clouds drift only on High. No straight streak lines anywhere.
5. [ ] Flowers appear in drifts of one kind, never on a plot.
6. [ ] The cards look like frosted glass on High, solid on Low.
7. [ ] Every skill still works, with cooldown rings, and a skill never ends the turn: after it the same player plants a seed (see "Free Action skills" below).
8. [ ] No console errors.

## Also worth a look after the cleanup (part 10)

- The only wood is the curb around the field and the fence. The lobby,
  Create Room, Join Room, Waiting and Game over screens are dark glass cards
  now, not wooden signboards.
- Nothing is missing where the old art used to be: the plots, plants, rocks,
  marks and clouds all come from the v3 pack.
- Item 8 on all three levels: on a normal load the console should show
  nothing at all, not even a failed request. The 3D game no longer requests
  the 2D renderer's art, and the page sets an empty favicon. A yellow
  warning names an art file whose size does not fit the manifest.
- `?render=2d` still plays with the old 2D look, as the fallback. It still
  uses the 2D wooden board and panels, and its missing 2D art files show as
  failed requests in the console there.
- FPS is measured separately: see "Performance results" in
  docs/art-direction-v3.md section 10.

## Free Action skills (what to check by eye)

A skill does not use the turn any more: the player uses at most one skill, then
plants a seed (docs/design.md section 4, docs/free-action-design.md). The rules are
covered by tests; these are the things only eyes can judge. Open
`http://localhost:8000/?local=1`, pick the characters named below, and use the
step by step version in docs/testing.md section 6 for two windows (`?transport=broadcast`
when served by `python3 -m http.server`). Check each on Low, Medium and High; Low has
marks and short slides but no particles.

- [ ] **The HUD flash:** when a skill is used, the card of its user flashes its character
      colour on the border (Wind Rabbit blue, Earth Bear ochre red, Jade Serpent jade
      green, Venom deep purple, Cloud Eagle pale yellow) and the turn pill, status line and
      banner say "Now plant a seed to end your turn." The other skill row reads "Already
      used a skill this turn." Petrification also shakes the card and puffs gold and green
      dust; Cloud floats white feathers out of the card.
- [ ] **The mud puddle and the sinking seed (Earth Bear):** Mud Trap turns an empty plot
      into a bubbling brown puddle that spreads out. A seed planted in it sinks below the
      ground, drawn pushed down and dim; one turn later the mud dries, cracks and the
      sprout pops up. An unused puddle dries and cracks after 4 turns. Both players see the
      same, except under a cloud: the opponent of the cloud's owner sees neither the puddle
      nor the sunk seed there. The sunk seed does not count for a row until it surfaces.
- [ ] **The petrified rock (Earth Bear):** Petrification wraps the enemy plant in gold
      energy from below, its colour drains to grey (it flickers between colour and grey
      first), it shatters and a mossy cobble rock pops in with dust rising and a light
      camera shake. The rock stays for good and looks the same for both players.
- [ ] **The secret cross and its reveal (Wind Rabbit):** the caster sees faint blue petals
      and a cross mark over 5 plots; the other seat sees nothing on the board, only the
      banner "Wind Rabbit placed a trap!". Check the other window never shows the cross
      before it fires. When a seed is planted on it the cross is revealed as a whirlwind,
      the seed spins up and is thrown in a long arc to a random free plot of the field with a small dust
      puff, then sprouts. If nobody fires it, it ends with no visual in the other window.
- [ ] **Wind Dash range:** the red target frame and the whirl on the source show in both
      windows; a target more than 3 plots away is refused with a message, not a crash.
- [ ] **The poison zone (Jade Serpent):** deep purple card flash, sap drops falling on the
      target plant (it droops a little and stays), the plots of the 3 by 3 square turning
      withered purple with low fog and toxic bubbles, a red crossed-out border when you
      hover a poisoned plot, and the zone thinning away after 2 turns.
- [ ] **The lock rune (Jade Serpent):** Hiss makes the Jade card glow and sends a purple
      wave to the opponent's card, which shakes lightly, dims its skill icons to about 40
      percent and shows a red blinking lock rune with "Locked: 1 turn". The rune is gone
      when the opponent's turn ends.
- [ ] **The 4 by 4 cloud from both seats (Cloud Eagle):** one cloud, two looks. The owner
      (and a spectator) sees a translucent cloud with every plant and rock under it. The
      other seat sees a dense, almost opaque cloud with now and then a flash of lightning
      and a small puff on every taken plot, never showing whose plant it is. The cloud
      covers 4 by 4 plots (smaller at the edges) with the clicked plot at the upper left
      of the middle 2 by 2, so it reaches 1 plot up and left and 2 plots down and right.
      Open it in two windows (or look at `?local=1` while the owner and then the opponent is
      to move) and compare.
- [ ] **No leaks and no crashes:** no console errors on any level, the 2D fallback
      (`?render=2d`) does not crash on mud, sunk seeds, poison or rocks, and no skill
      effect ever shows a plot the viewer may not see (under the other seat's cloud, or the
      secret cross).
