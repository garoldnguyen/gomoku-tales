# Gomoku Tales: Free Action rework (skills and balance)

**The final behaviour now lives in `docs/design.md`** (sections 3.1, 4, 5, 6, 8.1, 9.1 and 10; part 9 folded it back). That file describes the game as it is and wins over this one. This file stays as the detailed record of the rework: the owner's decisions (section 10), the reasons and the old names it replaced (Terrain Creation, Stone Conversion, and so on), which are named here only as history.

Status: it was the source of truth for the tasks "Free Action, part 1 of 9" to "Free Action, part 9 of 9" (the tasklist `.millstone/tasklist-free-action.md`). It comes from the owner's spec of October 2026 ("Skills & Balance Rework, Free Action Core"). Game text is English. Sound effects (SFX) are NOT part of this rework (section 9). The static mockups in `docs/reference/` are pictures of the look at the time they were made and still show the old Earth Bear skill names; they are not updated.

Every number below is a named constant in `src/config.js`, shared by the code, the tests and the texts. Nothing is typed twice.

## 1. Core rule: Free Action

Using a skill no longer uses the turn. On your turn you may use at most one skill that is ready, and then you MUST plant exactly one seed (stone) to end the turn. You cannot end a turn without planting, and you cannot plant first and use a skill after: planting ends the turn.

- `state.skillUsed` is `null` or the id of the skill used in the current turn. `useSkill` sets it and answers `{ ok: true, state, events }` with the same player still to move and the same `state.turn`. A second `useSkill` in the same turn is refused with the error `You already used a skill this turn.` (`STRINGS` is the UI text; the rules module uses the same sentence). The check order stays: game over, not your turn, unknown skill, not your skill, passive, cooldown, Hiss lock, then the new one-skill rule.
- `placeStone` is the only action that ends a turn. It resets `skillUsed` to `null` for the next player.
- Cooldowns keep their meaning: a skill with cooldown N cannot be used during the owner's next N turns. `useSkill` sets the full cooldown at once (so the HUD shows it right away). When the owner's turn ends, every cooldown of the owner counts down by one EXCEPT the skill used in that turn (`skillUsed`). Short = `COOLDOWN_SHORT` (3), long = `COOLDOWN_LONG` (6).
- `state.turn` is the number of the turn being played and grows by one only when a turn ends (a seed is planted). All durations below count turns this way. Example with the cast turn T: T is the caster's turn, T+1 the opponent's, T+2 the caster's again.
- The win check runs after every planting (and after a dash lands or a sunk seed surfaces, below). Skills themselves never change a plant of anybody into a winning line, so a skill never wins on its own.
- Hiss is unchanged in meaning: the opponent cannot use any skill on their next turn (`skillLock`, `HISS_LOCK_TURNS` = 1) and may still plant.
- Draw: the board is full AND no sunk seed is waiting to surface (section 3). The draw is decided after the last sunk seed surfaced and found no win.

## 2. Cell states (new, all public unless noted)

The board array keeps `EMPTY`, `X`, `O`, `ROCK` (and `HIDDEN` in a masked copy). New overlays live in the state, not in the board array:

| field | content | meaning |
|---|---|---|
| `state.mud` | `[{ x, y, player, driesAfterTurn }]` | a mud puddle on an EMPTY cell, made by `player` |
| `state.sunk` | `[{ x, y, player, surfacesAfterTurn }]` | a seed planted in mud: the cell holds that player's stone in `board` but it does not count (below) |
| `state.rocks` | `[{ x, y }]` | permanent rocks (petrified plants), also `ROCK` in `board`. There is no `breaksAfterTurn` any more and no rock breaks |
| `state.poison` | `null` or `{ player, x, y, cells, endsAfterTurn }` | Venom zone, `cells` = the 3 by 3 square around the target clipped to the board |
| `state.tornado` | `null` or `{ player, x, y, cells, endsAfterTurn }` | the secret cross trap |

`scoringBoard(state)` (new, pure, in `src/logic`) returns the board with every sunk cell replaced by a neutral marker `SUNK` (exported from `board.js`, like `HIDDEN`): a sunk seed belongs to nobody for lines, so it breaks every line like a rock. EVERY win check, the draw check and `skyWatchCells` read the scoring board, never the raw board. `isEmptyCell` stays "no stone and no rock": a mud cell is empty, a poisoned cell is empty but cannot be planted.

## 3. Earth Bear: Mud Trap and Petrification (replace Terrain Creation and Stone Conversion)

Mud Trap (`mudTrap`, short cooldown, target: one cell). Target must be an empty cell that is not already mud and not poisoned. The cell becomes a mud puddle: `{ x, y, player, driesAfterTurn: T + MUD_LIFETIME_TURNS }` (`MUD_LIFETIME_TURNS` = 4, same as the rock it replaces: the puddle dries at the end of the 4th turn after the cast turn, event `mudDried`). Either player (the caster too, also later in the cast turn) who plants on a mud cell plants a SUNK seed: the cell holds the stone, the puddle is used up (removed, no `mudDried`), `state.sunk` gets `{ x, y, player, surfacesAfterTurn: S + MUD_SINK_TURNS }` (`MUD_SINK_TURNS` = 1) where S is the turn of the planting, events `stonePlaced` then `stoneSunk`. A sunk seed counts for no line and for nobody (scoring board), so it makes no win now. At the end of turn S+1 (the opponent's turn) it surfaces (event `stoneSurfaced`, removed from `state.sunk`) and counts normally from then on; at that moment a win check runs for its owner at that cell (event `win` for the owner even though the other player acted; the acting player's own planting is checked first, so if both complete five in the same turn the acting player wins). Then the draw check runs.
- A sunk seed cannot be the source of Wind Dash or the target of Petrification (error `That plant is sunk in mud.`). Venom may target it (it is a plant of the opponent).
- A dash cannot land on mud and a Tornado throw never lands on mud (sections 4 and 5).
- Edge: if the last empty cell is mud and gets planted, the board is full but the draw waits until the seed has surfaced.

Petrification (`petrification`, long cooldown, target: one plant of the opponent). Target must be a plant of the opponent (X or O in the board) that is not sunk. It becomes a neutral permanent rock: `board[y][x] = ROCK`, `state.rocks` gets `{ x, y }`, event `stonePetrified { player, x, y, from }`. A rock breaks every line and can never be targeted or removed. A pending Wind Dash whose source was this plant fails when it resolves (`sourceLost`). Refused for an empty cell, a rock, an own plant, a sunk seed, or a cell off the board, with the usual errors; the turn is not used.

Removed: `terrainCreation`, `stoneConversion`, `ROCK_LIFETIME_TURNS`, the events `rockPlaced`, `rockBroken`, `stoneConverted`, and the breaking of rocks (`breakRocks`).

## 4. Wind Rabbit: Wind Dash and Tornado Zone

Wind Dash (`windDash`, short cooldown). As before, with a range: the source is one of the player's own plants (not sunk), the target is an empty cell that is not mud and not poisoned, at Chebyshev distance 1 to `WIND_DASH_RANGE` (3) from the source (the 7 by 7 square around it). Refusal text for a target too far: `That cell is too far for Wind Dash.` It resolves at the end of the opponent's next turn (`resolvesAfterTurn: T + 1`) only if the source still holds the dasher's plant and the target is still empty, not mud and not poisoned; otherwise `dashFailed` (`sourceLost` or `targetTaken`). The cooldown applies either way. Both players see the whirl on the source and the red frame on the target.

Tornado Zone (`tornadoZone`, long cooldown, target: the centre cell, any cell). A cross of 5 cells: the centre and its four orthogonal neighbours (`TORNADO_ARM` = 1 cell each way, replaces `TORNADO_SIZE`), clipped to the board. It is a secret trap: only the caster sees where it is (the masked state shows `{ player, hidden: true, endsAfterTurn }`, as now with `maskForViewer`).
- It is armed at once (owner's correction, October 2026: it used to arm only from the end of the cast turn): `endsAfterTurn: T + TORNADO_TURNS` (`TORNADO_TURNS` = 2: the opponent's next turn and the caster's next turn). The seed the caster plants to end the cast turn T fires it too, if it lies on the cross.
- When ANY player plants a seed on one of its cells (turn T to `endsAfterTurn`, the cast turn included), the trap fires at once and is used up (owner's decision: one use): events `tornadoStorm { player, x, y, cells }` (the cross is revealed to everybody now), then the seed is thrown to a random cell ANYWHERE on the board that is EMPTY, not mud and not poisoned (owner's correction, October 2026: it used to be one of the 8 neighbours; the host picks with the injected `random` from `throwTargets(state)`, row by row): `stoneThrown { player, from, to }`; with no such cell the seed stays (`throwBlocked`). The win check of the planting player runs where the seed ends up. If the seed ends on a mud cell (only when it stayed) it sinks.
- If nobody fires it, it ends at the end of turn `endsAfterTurn` (event `tornadoEnded`, nothing is revealed).
- The opponent sees NOTHING on the board while it waits. They only learn that the caster used the skill (the `skillUsed` event stays with `target: null`): the HUD card of the caster lights up and the banner says `Wind Rabbit placed a trap!` (character name from `CHARACTERS`).

## 5. Jade Serpent: Hiss and Venom

Hiss (`hiss`, short cooldown 3, no target). Unchanged rule (section 1). New look in the HUD (section 8).

Venom (`venom`, long cooldown, target: one plant of the opponent, sunk ones included). It no longer removes the plant. The 3 by 3 square around the target (`VENOM_ZONE_SIZE` = 3, clipped) becomes a poison zone `state.poison = { player, x, y, cells, endsAfterTurn: T + VENOM_TURNS }` (`VENOM_TURNS` = 2: it lasts through the opponent's next turn and the caster's next turn, and it bites at once, also for the caster's own planting in the cast turn). Nobody may plant on an empty cell of the zone (error `That cell is poisoned.`); a dash cannot target or land on it; Mud Trap cannot target it; a Tornado throw never lands on it. Plants already inside stay and keep counting. It ends at the end of turn `endsAfterTurn` (event `poisonEnded`). Both players see the zone. Refused when the zone would leave NO empty unpoisoned cell on the board (error `There would be no room left to plant.`), so the player to move can always plant (as built, a zone that is already lasting also ends early, event `poisonEnded`, when it would leave the next player no plot to plant on). The old event `plantRemoved` is gone; the new ones are `poisonPlaced { player, x, y, cells, endsAfterTurn }` and `poisonEnded { player }`.

## 6. Cloud Eagle: Sky Watch and Cloud

Sky Watch (passive) keeps the owner's rule of October 2026: it marks the empty cells where the opponent would make `SKY_WATCH_RUN` (4) or more in a row with one more plant, now on the scoring board (a sunk seed counts for nobody). Only the eagle's side and spectators see it.

Cloud (`cloud`, long cooldown 6, target: any cell). The area is `CLOUD_SIZE` (now 4) by 4 cells. A 4 by 4 area has no centre cell, so the clicked cell is the upper left cell of the middle 2 by 2: the cloud covers x-1 to x+2 and y-1 to y+2, clipped to the board. In code: `lo = floor((CLOUD_SIZE - 1) / 2)`, `hi = CLOUD_SIZE - 1 - lo`, covering `x - lo` to `x + hi` (for an odd size this is the old centred square, so the code stays right for any size). `CLOUD_TURNS` (2) and the hiding rules (`maskForViewer`, covered cells, `HIDDEN` for taken covered cells, empty covered cells stay plantable, `COVERED_ERROR` for skill targets) are unchanged. The poison zone is public data, but the other seat's board draws nothing of it on a covered cell; a mud puddle and a sunk seed on a covered cell are hidden from the other seat (their entries leave the masked `mud` and `sunk` lists, their events are hidden like other events that name a covered cell, section 7).

## 7. Hidden information summary

`maskForViewer` / `maskEventsForViewer` (src/logic/cloud.js) stay the only masking path (room.send still runs them on every host message). They now also: hide the tornado cross from the other seat (as now), drop `sunk` entries and mud entries of covered cells, and keep `tornadoStorm` (the reveal) and the `skillUsed` of Tornado Zone visible with no target. A guest must never learn the cross before it fires, a hidden cell from a sunk or surfaced seed, or a covered wind dash. Each message type keeps its test.

## 8. Look and feel (what the owner described; numbers go to `src/config.js`)

Quality levels follow the one table in `src/render3d/quality.js`: Low gets marks and short slides but no particles, Medium a few, High the full effect (the particle cap of the table, no code tests a level name). Nothing allocates per frame.

HUD cast flash (every skill, new): when a skill is used, the HUD card of its user flashes its character colour on the border for a short time (`SKILL_FLASH_MS`); Earth Bear ochre red, Wind Rabbit blue, Jade Serpent jade green (Venom deep purple), Cloud Eagle pale yellow. After a skill the other skill rows are disabled with the hint `Already used a skill this turn.`, and the banner says `Now plant a seed to end your turn.`

- Mud Trap: the plot sinks into a bubbling mud puddle (brown, crackling bubbles). A seed planted in it sinks below the ground (the plant drawn pushed down and dim), the next turn the mud dries and cracks and the sprout pops up. Both players see the same.
- Petrification: HUD card shakes slightly and puffs gold and green dust. The enemy plant is wrapped by energy from below, loses its colour (turns grey), shatters and becomes a mossy cobble rock with dust rising. Both players see it.
- Wind Dash: keeps the current look (whirl on the source, red translucent bracket frame on the target, the plant folds into a seed, flies in an arc and sprouts again). Only the range changes.
- Tornado Zone: the caster sees faint blue petals (opacity 40 percent) drifting over the 5 cells as a reminder; the opponent sees nothing on the board (the old field-wide gust for the other seat is removed). When it fires, the cross bursts into a visible whirlwind that spins the seed up and throws it in an arc to the plot it lands on, with a small dust puff, then it sprouts. The flight is longer and the arc higher for a farther plot (`throwFlightMs`, `throwArcHeight`, up to `THROW_MS_MAX` and `THROW_ARC_MAX`).
- Hiss: the Jade card glows and sends a purple sonic wave to the opponent's HUD card. The opponent's card shakes lightly, their skill icons dim to grey (opacity 40 percent) and a red blinking lock rune with the text `Locked: 1 turn` shows (the number from `HISS_LOCK_TURNS`; replaces the text `Silenced by Hiss`).
- Venom: deep purple card flash; venom sap drops fall from the sky onto the target plant, which wilts a little (stays on the board); the 8 plots around it turn withered purple with low fog and toxic bubbles hugging the ground; hovering a poisoned plot shows a red crossed-out border.
- Sky Watch: unchanged look (soft pale gold outline, a drifting cloud and a light ray on each marked plot).
- Cloud: pale yellow card flash with white feathers floating out of the HUD; the owner and spectators see a translucent (opacity 50 percent) pixel cloud and see everything under it; the other seat sees a dense cloud (opacity `CLOUD_OPPONENT_OPACITY`, near 100 percent) with now and then a flash of lightning (`CLOUD_LIGHTNING_MS`); the small puffs on taken covered plots stay because the rules still tell the other seat which covered plots are taken. Clicking a covered cell for a skill target answers `That cell is under a cloud.`

New art slots: the HUD icons `icon-mud-trap` and `icon-petrification` (the same size as the Terrain Creation and Stone Conversion HUD icons they replace) in `assets/manifest.json`, registered in the loader so a missing file only warns and shows a placeholder, like the Cloud Eagle files. No other new image file is required: puddles, rocks, zones, bubbles, fog and lightning are drawn from existing sprites, generated pixel textures and particles. The 2D renderer (`?render=2d`) must not crash on the new state or events; it may show the new overlays as plain tints or ignore them.

## 9. Not in this rework

Sound effects (the owner's SFX lines: mud squelch, wind chime, serpent hiss, thunder and so on) are a later task: they need a mute control and cannot be checked by tests. `docs/design.md` keeps saying "no sound" until then. No other character, no new map, no change to the room, chat or spectator features, no change to the board size, win length (5) or room codes.

## 10. Decisions made for the owner's open points

| point | decision | constant |
|---|---|---|
| Sky Watch threshold | stays 4 (owner's choice, October 6 rule) | `SKY_WATCH_RUN` = 4 |
| Mud puddle left unused | dries after 4 turns (owner's choice) | `MUD_LIFETIME_TURNS` = 4 |
| Tornado trap after it fires | used up at once (owner's choice) | |
| Mud Trap cooldown | short (not in the owner's text) | `COOLDOWN_SHORT` |
| Wind Dash range | 3 cells, Chebyshev | `WIND_DASH_RANGE` = 3 |
| Tornado shape | cross of 5 cells | `TORNADO_ARM` = 1 |
| Tornado landing | a random empty plot anywhere on the board (not mud, not poisoned) | owner's correction, October 2026 |
| Tornado arming | at once, the cast turn's own planting fires it | owner's correction, October 2026 |
| Venom duration | 2 turns after the cast turn, bites at once | `VENOM_TURNS` = 2 |
| 4 by 4 cloud anchor | clicked cell = upper left of the middle 2 by 2 | `CLOUD_SIZE` = 4 |
| Cloud for the other seat | dense look, rules unchanged | `CLOUD_OPPONENT_OPACITY` |
| Rocks | all rocks are permanent petrified plants | |

## 11. Test checklist (each part adds its own)

Part 1: one skill per turn; skill without planting leaves the same player to move and `turn` unchanged; the cooldown set at use and counting down from the next turn; Hiss, Wind Dash timing, Cloud turns, Tornado turns still count by turns; a skill never ends the game. Part 2: mud sinks and surfaces on time (win at surfacing for the owner, the acting player's own win first), the deferred draw, scoring board, rocks permanent, errors. Part 3: dash range edges, dash onto mud or poison, the cross shape at corners, arming, one use, throw candidates, win after a throw. Part 4: poison zone cells at edges, planting refused, the no-room refusal, ends on time. Part 5: the 4 by 4 area at edges, offsets for odd and even sizes, Sky Watch with a sunk seed. Masking: one test per message type that no hidden cross, covered cell or sunk entry reaches the other seat.
