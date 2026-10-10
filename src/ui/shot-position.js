// The fixed mid game position of the `field` shot scene (docs/shots.md
// section 4): ONE constant, played through the rules by shot mode
// (src/ui/shot-mode.js), so it is legal by construction and
// tests/shot-mode.test.js checks it. Cells are { x, y } with board[y][x].
// It only feeds the screenshot self-check; normal play never reads it.

import { MUD_TRAP, PETRIFICATION } from '../logic/skills.js';

export const SHOT_FIELD = Object.freeze({
  // Actions in order, Wind Rabbit (X) first: a cell places a seed, a cell
  // with a skill uses that skill on it. A skill does not end the turn (Free
  // Action), so the same player plants next. 14 seeds, one rock and one
  // seed sunk in mud, no winner. A mud puddle and a sunk seed can never
  // stand together: the seed uses the puddle up, a puddle lasts 4 turns and
  // Mud Trap rests 3 own turns, so the picture shows the sunk seed (X
  // planted the last seed into the puddle O made on its turn 14).
  actions: Object.freeze([
    { x: 7, y: 7 }, // 1 X
    { x: 7, y: 7, skill: PETRIFICATION }, // 2 O: X's first plant turns to a rock, then the same turn goes on
    { x: 8, y: 8 }, // 2 O
    { x: 6, y: 6 }, // 3 X
    { x: 8, y: 6 }, // 4 O
    { x: 8, y: 7 }, // 5 X
    { x: 9, y: 9 }, // 6 O
    { x: 9, y: 7 }, // 7 X
    { x: 10, y: 7 }, // 8 O
    { x: 6, y: 7 }, // 9 X
    { x: 5, y: 7 }, // 10 O
    { x: 7, y: 8 }, // 11 X
    { x: 4, y: 7 }, // 12 O
    { x: 7, y: 6 }, // 13 X
    { x: 6, y: 9, skill: MUD_TRAP }, // 14 O: a mud puddle, then the same turn goes on
    { x: 7, y: 9 }, // 14 O
    { x: 6, y: 9 }, // 15 X: plants into the puddle, so the seed is sunk (the last move)
  ]),
  // Plants shown still growing: ms since their seed was planted at the
  // frozen shot time (Land, Sprout and Open, see assets/v3-meta.json).
  growing: Object.freeze([
    { x: 7, y: 8, ageMs: 300 },
    { x: 7, y: 9, ageMs: 600 },
    { x: 7, y: 6, ageMs: 1000 },
  ]),
  // The last move rests with its marker fully shown.
  lastMoveAgeMs: 2000,
  // The skill the player to move (Earth Bear, O) has selected: Petrification
  // rested after its cast on turn 2 and is ready again on turn 16.
  selectedSkill: PETRIFICATION,
});

// The `freeaction` shot scene (docs/free-action-design.md section 8): the
// field position up to the Mud Trap of turn 14, before the same player
// plants. It is the first actions of SHOT_FIELD (the Mud Trap is the last
// of them), so it is legal by construction. O used the skill and must plant:
// the hint says so, every other skill row is off, the Mud Trap row shows its
// rest at once and the card of O shows the flash of its character. No skill
// is selected.
export const SHOT_FREE_ACTION = Object.freeze({
  actionCount: SHOT_FIELD.actions.findIndex((action) => action.skill === MUD_TRAP) + 1,
  // Plants shown still growing; the last plant (X, seed 13) is the last move.
  growing: Object.freeze([
    { x: 7, y: 8, ageMs: 300 },
  ]),
  lastMoveAgeMs: SHOT_FIELD.lastMoveAgeMs,
});
