// Test helper (not a test file): Free Action turns (docs/free-action-design.md
// section 1). A skill does not end the turn any more, so a test that wants
// the turn to pass after a skill plants a seed too. Works on the rules state
// of src/logic/game.js.

import assert from 'node:assert/strict';
import { EMPTY } from '../src/logic/board.js';
import { placeStone, useSkill } from '../src/logic/game.js';

// The first empty cell of the odd rows near the bottom, x even, so a spare
// seed never makes a line, never lands on the cells the tests use near the
// top and the middle, and never meets the filler seeds of the cooldown
// tests (they use the even rows).
export function spareCell(board) {
  for (const y of [13, 11, 9]) {
    for (let x = 0; x < board[y].length; x += 2) {
      if (board[y][x] === EMPTY) return { x, y };
    }
  }
  throw new Error('no spare cell');
}

// player uses the skill (the turn goes on) and then plants a seed at cell
// (default: a spare cell) which ends the turn. Returns the state with the
// other player to move; `events` gets the events of both steps when given.
export function skillTurn(state, player, skill, target = null, cell = null, events = null) {
  const used = useSkill(state, { player, skill, target });
  assert.equal(used.ok, true, used.error);
  const spot = cell ?? spareCell(used.state.board);
  const planted = placeStone(used.state, { player, x: spot.x, y: spot.y });
  assert.equal(planted.ok, true, planted.error);
  if (events) events.push(...used.events, ...planted.events);
  return planted.state;
}
