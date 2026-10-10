// Game v5 part 1: Jade Serpent (Hiss, Venom) and sides by pick order
// (docs/design.md section 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOLDOWN_SHORT, COOLDOWN_LONG } from '../src/config.js';
import { EMPTY, ROCK, X, O } from '../src/logic/board.js';
import {
  CHARACTERS, EARTH_BEAR, FIRST_PLAYER, JADE_SERPENT, WIND_RABBIT, assignSides, characterForStone, stoneForCharacter,
} from '../src/logic/characters.js';
import { canUseSkill, characterOf, newGame, placeStone, skillCooldown, useSkill } from '../src/logic/game.js';
import { HISS, LONG, SHORT, TERRAIN_CREATION, VENOM, WIND_DASH, cooldownTurns, getSkill } from '../src/logic/skills.js';
import { skillTurn } from './skill-turn.js';

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function place(state, player, x, y) {
  return ok(placeStone(state, { player, x, y }));
}

// Jade Serpent picked first (X) against Earth Bear (O).
function serpentGame(second = EARTH_BEAR) {
  return newGame({ characters: assignSides([JADE_SERPENT, second]) });
}

// --- Pick order ---

test('assignSides: the first pick plays X, the second plays O, and X moves first', () => {
  assert.deepEqual(assignSides([JADE_SERPENT, WIND_RABBIT]), { [X]: JADE_SERPENT, [O]: WIND_RABBIT });
  assert.deepEqual(assignSides([EARTH_BEAR, JADE_SERPENT]), { [X]: EARTH_BEAR, [O]: JADE_SERPENT });
  assert.deepEqual(assignSides([EARTH_BEAR, WIND_RABBIT]), { [X]: EARTH_BEAR, [O]: WIND_RABBIT });
  assert.equal(FIRST_PLAYER, X);
  const state = newGame({ characters: assignSides([EARTH_BEAR, WIND_RABBIT]) });
  assert.equal(state.currentPlayer, X);
  assert.equal(characterOf(state, X).id, EARTH_BEAR);
  assert.equal(characterOf(state, O).id, WIND_RABBIT);
  assert.deepEqual(Object.keys(state.cooldowns[X]), CHARACTERS[EARTH_BEAR].skills);
  assert.deepEqual(Object.keys(state.cooldowns[O]), CHARACTERS[WIND_RABBIT].skills);
  // Earth Bear now plays X: its skills are X's, Wind Rabbit's are not.
  assert.equal(canUseSkill(state, X, TERRAIN_CREATION), true);
  assert.equal(useSkill(state, { player: X, skill: WIND_DASH, target: null }).error, 'That is not your skill.');
});

test('assignSides rejects the same character twice or an unknown one', () => {
  assert.throws(() => assignSides([JADE_SERPENT, JADE_SERPENT]));
  assert.throws(() => assignSides([JADE_SERPENT, 'nope']));
  assert.throws(() => assignSides([]));
});

test('the side comes from the sides, not from the character', () => {
  const sides = assignSides([JADE_SERPENT, WIND_RABBIT]);
  assert.equal(characterForStone(X, sides).id, JADE_SERPENT);
  assert.equal(stoneForCharacter(WIND_RABBIT, sides), O);
  assert.equal(stoneForCharacter(EARTH_BEAR, sides), null);
  assert.equal(characterForStone(ROCK, sides), null);
});

// --- Registry and cooldowns ---

test('Jade Serpent owns Hiss (short) and Venom (long)', () => {
  assert.deepEqual(CHARACTERS[JADE_SERPENT], { id: JADE_SERPENT, name: 'Jade Serpent', skills: [HISS, VENOM] });
  assert.equal(getSkill(HISS).name, 'Hiss');
  assert.equal(getSkill(VENOM).name, 'Venom');
  assert.equal(getSkill(HISS).cooldownClass, SHORT);
  assert.equal(getSkill(VENOM).cooldownClass, LONG);
  assert.equal(cooldownTurns(HISS), COOLDOWN_SHORT);
  assert.equal(cooldownTurns(VENOM), COOLDOWN_LONG);
});

test('Hiss rests COOLDOWN_SHORT own turns and Venom COOLDOWN_LONG', () => {
  let state = serpentGame();
  state = ok(useSkill(state, { player: X, skill: HISS }));
  assert.equal(skillCooldown(state, X, HISS), COOLDOWN_SHORT);
  state = place(state, X, 12, 12); // the planting that ends the turn does not count it down
  assert.equal(skillCooldown(state, X, HISS), COOLDOWN_SHORT);
  // The cooldown counts down on the serpent's own turns only.
  let row = 0;
  for (let i = 0; i < COOLDOWN_SHORT; i++) {
    state = place(state, O, 14, row);
    assert.equal(canUseSkill(state, X, HISS), false);
    state = place(state, X, 0, row);
    row += 2;
  }
  assert.equal(skillCooldown(state, X, HISS), 0);
  state = place(state, O, 14, row);
  assert.equal(canUseSkill(state, X, HISS), true);

  state = serpentGame();
  state = place(state, X, 7, 7);
  state = place(state, O, 8, 8);
  state = ok(useSkill(state, { player: X, skill: VENOM, target: { x: 8, y: 8 } }));
  assert.equal(skillCooldown(state, X, VENOM), COOLDOWN_LONG);
  state = place(state, X, 0, 14);
  assert.match(useSkill(place(state, O, 3, 3), { player: X, skill: VENOM, target: { x: 3, y: 3 } }).error, /cooldown/);
});

// --- Hiss ---

test('Hiss: the opponent cannot use a skill on their next turn, and the lock ends after it', () => {
  let state = serpentGame();
  const result = useSkill(state, { player: X, skill: HISS });
  state = ok(result);
  assert.ok(result.events.some((e) => e.type === 'hissCast' && e.player === X && e.locked === O));
  assert.equal(state.currentPlayer, X, 'the turn goes on: the serpent still plants');
  state = place(state, X, 0, 14);
  assert.equal(state.currentPlayer, O);
  for (const skill of CHARACTERS[EARTH_BEAR].skills) {
    assert.equal(canUseSkill(state, O, skill), false);
    assert.equal(skillCooldown(state, O, skill), 0, 'not a cooldown');
  }
  const rejected = useSkill(state, { player: O, skill: TERRAIN_CREATION, target: { x: 4, y: 4 } });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Hiss/);

  // The opponent plants; the lock ends with that turn.
  const after = placeStone(state, { player: O, x: 4, y: 4 });
  state = ok(after);
  assert.ok(after.events.some((e) => e.type === 'hissEnded' && e.player === O));
  assert.equal(state.skillLock, null);
  state = place(state, X, 0, 0);
  assert.equal(canUseSkill(state, O, TERRAIN_CREATION), true);
  ok(useSkill(state, { player: O, skill: TERRAIN_CREATION, target: { x: 5, y: 5 } }));
});

test('Hiss still allows placing a stone', () => {
  const state = place(ok(useSkill(serpentGame(), { player: X, skill: HISS })), X, 0, 0);
  const next = place(state, O, 7, 7);
  assert.equal(next.board[7][7], O);
  assert.equal(next.currentPlayer, X);
});

test('Hiss does not lock the serpent itself', () => {
  let state = ok(useSkill(serpentGame(), { player: X, skill: HISS }));
  state = place(state, X, 0, 0);
  state = place(state, O, 7, 7);
  assert.equal(canUseSkill(state, X, VENOM), true);
});

// --- Venom ---

test('Venom removes exactly one opponent plant, leaves the plot empty and keeps rocks', () => {
  let state = serpentGame();
  state = place(state, X, 7, 7);
  state = place(state, O, 8, 8);
  state = place(state, X, 7, 9);
  state = place(state, O, 9, 9);
  state = place(state, X, 0, 9);
  state = skillTurn(state, O, TERRAIN_CREATION, { x: 2, y: 2 }, { x: 14, y: 14 });
  const before = state;
  const result = useSkill(state, { player: X, skill: VENOM, target: { x: 8, y: 8 } });
  state = ok(result);
  assert.equal(state.board[8][8], EMPTY);
  assert.equal(state.board[9][9], O);
  assert.equal(state.board[2][2], ROCK, 'the rock stays');
  assert.deepEqual(state.rocks, before.rocks);
  let changed = 0;
  for (let y = 0; y < before.board.length; y++) {
    for (let x = 0; x < before.board.length; x++) if (before.board[y][x] !== state.board[y][x]) changed++;
  }
  assert.equal(changed, 1, 'exactly one plot changed');
  assert.ok(result.events.some((e) => e.type === 'plantRemoved' && e.x === 8 && e.y === 8 && e.from === O));
  assert.equal(state.currentPlayer, X, 'using Venom does not end the turn');
});

test('Venom is rejected on an empty plot, on your own plant, on a rock and off the board', () => {
  let state = serpentGame();
  state = place(state, X, 7, 7);
  state = skillTurn(state, O, TERRAIN_CREATION, { x: 2, y: 2 }, { x: 14, y: 14 });
  for (const target of [{ x: 0, y: 0 }, { x: 7, y: 7 }, { x: 2, y: 2 }, { x: -1, y: 0 }, null]) {
    const result = useSkill(state, { player: X, skill: VENOM, target });
    assert.equal(result.ok, false, JSON.stringify(target));
    assert.deepEqual(result.events, []);
  }
  assert.equal(skillCooldown(state, X, VENOM), 0, 'a rejected skill costs nothing');
  assert.equal(state.currentPlayer, X);
});
