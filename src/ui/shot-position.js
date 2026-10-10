// The fixed mid game position of the `field` shot scene (docs/shots.md
// section 4): ONE constant, played through the rules by shot mode
// (src/ui/shot-mode.js), so it is legal by construction and
// tests/shot-mode.test.js checks it. Cells are { x, y } with board[y][x].
// It only feeds the screenshot self-check; normal play never reads it.

import { STONE_CONVERSION, TERRAIN_CREATION } from '../logic/skills.js';

export const SHOT_FIELD = Object.freeze({
  // Actions in order, Wind Rabbit (X) first: a cell places a seed, a cell
  // with a skill uses that skill on it. A skill does not end the turn (Free
  // Action), so the same player plants next. 15 seeds and one rock, no winner.
  actions: Object.freeze([
    { x: 7, y: 7 }, // 1 X
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
    { x: 6, y: 9, skill: TERRAIN_CREATION }, // 12 O: a rock falls, then the same turn goes on
    { x: 4, y: 7 }, // 12 O
    { x: 7, y: 6 }, // 13 X
    { x: 7, y: 9 }, // 14 O
    { x: 5, y: 9 }, // 15 X: the last move
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
  // The skill the player to move (Earth Bear, O) has selected.
  selectedSkill: STONE_CONVERSION,
});
