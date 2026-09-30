import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, COOLDOWN_LONG, COOLDOWN_SHORT, ROCK_LIFETIME_TURNS } from '../src/config.js';
import { EMPTY, X, O, ROCK } from '../src/logic/board.js';
import { STONE_CONVERSION, TERRAIN_CREATION } from '../src/logic/skills.js';
import { createInitialState, isGameOver, placeStone, skillCooldown, useSkill } from '../src/logic/game.js';

// Builds a playing state with cells set directly: [[x, y, value], ...].
function stateWith(cells, currentPlayer = O) {
  const state = createInitialState();
  for (const [x, y, value] of cells) state.board[y][x] = value;
  state.currentPlayer = currentPlayer;
  return state;
}

function place(state, player, x, y) {
  const result = placeStone(state, { player, x, y });
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function skillResult(state, player, skill, target) {
  const result = useSkill(state, { player, skill, target });
  assert.equal(result.ok, true, result.error);
  return result;
}

function assertSkillRejected(state, action, errorPattern) {
  const before = JSON.stringify(state);
  const result = useSkill(state, action);
  assert.equal(result.ok, false);
  assert.match(result.error, errorPattern);
  assert.deepEqual(result.events, []);
  assert.equal(JSON.stringify(state), before, 'state must not change');
}

// X places at (0, 0), then Earth Bear drops a rock on (7, 7) on turn 2.
function stateWithRock() {
  const state = place(createInitialState(), X, 0, 0);
  return skillResult(state, O, TERRAIN_CREATION, { x: 7, y: 7 }).state;
}

// --- TERRAIN CREATION ---

test('Terrain Creation drops a rock on an empty cell at once and uses the turn', () => {
  const state = place(createInitialState(), X, 0, 0);
  const result = skillResult(state, O, TERRAIN_CREATION, { x: 7, y: 7 });
  assert.equal(result.state.board[7][7], ROCK);
  assert.deepEqual(result.state.rocks, [{ x: 7, y: 7, breaksAfterTurn: 2 + ROCK_LIFETIME_TURNS }]);
  assert.equal(result.state.currentPlayer, X);
  assert.equal(result.state.turn, 3);
  assert.equal(skillCooldown(result.state, O, TERRAIN_CREATION), COOLDOWN_SHORT);
  assert.deepEqual(result.events, [
    { type: 'skillUsed', player: O, skill: TERRAIN_CREATION, target: { x: 7, y: 7 } },
    { type: 'rockPlaced', player: O, x: 7, y: 7, breaksAfterTurn: 6 },
    { type: 'turnEnded', player: O, turn: 2 },
  ]);
  assert.equal(state.board[7][7], EMPTY, 'the given state is not mutated');
  assert.deepEqual(JSON.parse(JSON.stringify(result.state)), result.state);
});

test('Terrain Creation works on any empty cell, including corners', () => {
  for (const [x, y] of [[0, 0], [14, 0], [0, 14], [14, 14]]) {
    const result = skillResult(stateWith([]), O, TERRAIN_CREATION, { x, y });
    assert.equal(result.state.board[y][x], ROCK);
  }
});

test('Terrain Creation rejects a cell that is not empty or not on the board', () => {
  const state = stateWith([[3, 3, X], [4, 4, O], [5, 5, ROCK]]);
  const action = (target) => ({ player: O, skill: TERRAIN_CREATION, target });
  assertSkillRejected(state, action({ x: 3, y: 3 }), /not empty/);
  assertSkillRejected(state, action({ x: 4, y: 4 }), /not empty/);
  assertSkillRejected(state, action({ x: 5, y: 5 }), /not empty/);
  assertSkillRejected(state, action({ x: -1, y: 0 }), /on the board/);
  assertSkillRejected(state, action({ x: 0, y: BOARD_SIZE }), /on the board/);
  assertSkillRejected(state, action({ x: 1.5, y: 0 }), /on the board/);
  assertSkillRejected(state, action(null), /on the board/);
  assertSkillRejected(state, { player: O, skill: TERRAIN_CREATION }, /on the board/);
});

// --- Rocks block the cell ---

test('a rock blocks placement for both players', () => {
  let state = stateWithRock();
  const before = JSON.stringify(state);
  const xTry = placeStone(state, { player: X, x: 7, y: 7 });
  assert.equal(xTry.ok, false);
  assert.match(xTry.error, /not empty/);
  assert.equal(JSON.stringify(state), before);

  state = place(state, X, 1, 1);
  const oTry = placeStone(state, { player: O, x: 7, y: 7 });
  assert.equal(oTry.ok, false);
  assert.match(oTry.error, /not empty/);
});

test('a rock cannot be converted', () => {
  const state = stateWith([[5, 5, ROCK]]);
  assertSkillRejected(state, { player: O, skill: STONE_CONVERSION, target: { x: 5, y: 5 } }, /opponent's stones/);
});

test('a rock breaks the opponent\'s line', () => {
  // X X X X _ with a rock dropped on the fifth cell: X cannot finish there.
  const cells = [0, 1, 2, 3].map((x) => [x, 0, X]);
  let state = skillResult(stateWith(cells), O, TERRAIN_CREATION, { x: 4, y: 0 }).state;
  assert.equal(placeStone(state, { player: X, x: 4, y: 0 }).ok, false);
  state = place(state, X, 9, 9);
  assert.equal(state.winner, null);
});

// --- Rock lifetime ---

test('a rock lasts for the 4 turns after it is created and breaks at the end of the 4th', () => {
  // Created on turn 2 by O.
  let state = stateWithRock();
  const moves = [[X, 1, 0], [O, 2, 0], [X, 3, 0]]; // turns 3, 4, 5
  for (const [player, x, y] of moves) {
    const result = placeStone(state, { player, x, y: y + 10 });
    assert.equal(result.ok, true);
    assert.equal(result.events.some((e) => e.type === 'rockBroken'), false);
    state = result.state;
    assert.equal(state.board[7][7], ROCK, `rock still there after turn ${state.turn - 1}`);
  }

  // Turn 6 (O's second turn after the rock): the rock still blocks the cell.
  assert.equal(state.turn, 2 + ROCK_LIFETIME_TURNS);
  assert.equal(placeStone(state, { player: O, x: 7, y: 7 }).ok, false);

  // At the end of turn 6 the rock breaks and leaves an empty cell.
  const result = placeStone(state, { player: O, x: 4, y: 10 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.events, [
    { type: 'stonePlaced', player: O, x: 4, y: 10 },
    { type: 'rockBroken', x: 7, y: 7 },
    { type: 'turnEnded', player: O, turn: 6 },
  ]);
  state = result.state;
  assert.equal(state.board[7][7], EMPTY);
  assert.deepEqual(state.rocks, []);

  // Turn 7: X can now place on the old rock cell.
  state = place(state, X, 7, 7);
  assert.equal(state.board[7][7], X);
});

test('a rock also breaks when the 4th turn is a skill', () => {
  let state = place(stateWithRock(), X, 1, 10); // turn 3
  state = place(state, O, 2, 10); // turn 4
  state = place(state, X, 3, 10); // turn 5
  // Turn 6: O converts instead of placing.
  const result = skillResult(state, O, STONE_CONVERSION, { x: 3, y: 10 });
  assert.equal(result.state.board[7][7], EMPTY);
  assert.deepEqual(result.events.map((e) => e.type), ['skillUsed', 'stoneConverted', 'rockBroken', 'turnEnded']);
});

test('each rock breaks on its own schedule', () => {
  // Two rocks created on different turns (the cooldown is reset by hand
  // so the second rock can be dropped two turns later).
  let twoRocks = stateWith([]);
  twoRocks.turn = 2;
  twoRocks = skillResult(twoRocks, O, TERRAIN_CREATION, { x: 1, y: 1 }).state; // turn 2
  twoRocks.cooldowns = { ...twoRocks.cooldowns, O: { ...twoRocks.cooldowns.O, [TERRAIN_CREATION]: 0 } };
  twoRocks = place(twoRocks, X, 0, 14); // turn 3
  twoRocks = skillResult(twoRocks, O, TERRAIN_CREATION, { x: 2, y: 2 }).state; // turn 4
  twoRocks = place(twoRocks, X, 1, 14); // turn 5
  const sixth = placeStone(twoRocks, { player: O, x: 2, y: 14 }); // turn 6
  assert.deepEqual(sixth.events.filter((e) => e.type === 'rockBroken'), [{ type: 'rockBroken', x: 1, y: 1 }]);
  assert.equal(sixth.state.board[1][1], EMPTY);
  assert.equal(sixth.state.board[2][2], ROCK);
  twoRocks = place(sixth.state, X, 3, 14); // turn 7
  const eighth = placeStone(twoRocks, { player: O, x: 4, y: 14 }); // turn 8
  assert.deepEqual(eighth.events.filter((e) => e.type === 'rockBroken'), [{ type: 'rockBroken', x: 2, y: 2 }]);
  assert.equal(eighth.state.board[2][2], EMPTY);
  assert.deepEqual(eighth.state.rocks, []);
});

test('a rock that breaks at the end of the turn does not make a full board a draw', () => {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if ((x !== 0 || y !== 0) && (x !== 1 || y !== 0)) cells.push([x, y, ROCK]);
    }
  }
  const state = stateWith(cells, X);
  state.board[0][1] = ROCK;
  state.rocks = [{ x: 1, y: 0, breaksAfterTurn: state.turn }];
  const result = placeStone(state, { player: X, x: 0, y: 0 });
  assert.equal(result.state.draw, false);
  assert.equal(result.state.board[0][1], EMPTY);
});

// --- STONE CONVERSION ---

test('Stone Conversion turns one opponent stone into an O stone at once and uses the turn', () => {
  const state = stateWith([[6, 6, X], [7, 7, X]]);
  const result = skillResult(state, O, STONE_CONVERSION, { x: 6, y: 6 });
  assert.equal(result.state.board[6][6], O);
  assert.equal(result.state.board[7][7], X, 'only the chosen stone changes');
  assert.equal(result.state.currentPlayer, X);
  assert.equal(skillCooldown(result.state, O, STONE_CONVERSION), COOLDOWN_LONG);
  assert.deepEqual(result.events, [
    { type: 'skillUsed', player: O, skill: STONE_CONVERSION, target: { x: 6, y: 6 } },
    { type: 'stoneConverted', player: O, x: 6, y: 6, from: X },
    { type: 'turnEnded', player: O, turn: 1 },
  ]);
  assert.equal(state.board[6][6], X, 'the given state is not mutated');
});

test('Stone Conversion only converts opponent stones', () => {
  const state = stateWith([[3, 3, X], [4, 4, O], [5, 5, ROCK]]);
  const action = (target) => ({ player: O, skill: STONE_CONVERSION, target });
  assertSkillRejected(state, action({ x: 4, y: 4 }), /opponent's stones/);
  assertSkillRejected(state, action({ x: 5, y: 5 }), /opponent's stones/);
  assertSkillRejected(state, action({ x: 0, y: 0 }), /opponent's stones/);
  assertSkillRejected(state, action({ x: BOARD_SIZE, y: 0 }), /on the board/);
  assertSkillRejected(state, action(null), /on the board/);
  assert.equal(useSkill(state, action({ x: 3, y: 3 })).ok, true);
});

test('a conversion that creates five in a row wins for Earth Bear at once', () => {
  // O O X O O -> converting the X makes five O in a row.
  const state = stateWith([[2, 5, O], [3, 5, O], [4, 5, X], [5, 5, O], [6, 5, O]]);
  const result = skillResult(state, O, STONE_CONVERSION, { x: 4, y: 5 });
  assert.equal(result.state.winner, O);
  assert.equal(isGameOver(result.state), true);
  assert.deepEqual(result.state.winLine, [2, 3, 4, 5, 6].map((x) => ({ x, y: 5 })));
  assert.deepEqual(result.events.map((e) => e.type), ['skillUsed', 'stoneConverted', 'win']);
  assert.equal(result.state.currentPlayer, O, 'the turn does not pass after a win');
  assert.equal(placeStone(result.state, { player: X, x: 0, y: 0 }).ok, false);
});

test('a diagonal conversion that makes six in a row also wins', () => {
  const cells = [0, 1, 2, 4, 5].map((i) => [i + 3, i + 3, O]);
  const state = stateWith([...cells, [6, 6, X]]);
  const result = skillResult(state, O, STONE_CONVERSION, { x: 6, y: 6 });
  assert.equal(result.state.winner, O);
  assert.equal(result.state.winLine.length, 6);
});

test('a conversion that does not make five lets the game go on', () => {
  const state = stateWith([[2, 5, O], [3, 5, O], [4, 5, X], [5, 5, O]]);
  const result = skillResult(state, O, STONE_CONVERSION, { x: 4, y: 5 });
  assert.equal(result.state.winner, null);
  assert.equal(result.state.currentPlayer, X);
});
