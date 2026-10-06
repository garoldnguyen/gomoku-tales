import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, COOLDOWN_LONG, COOLDOWN_SHORT } from '../src/config.js';
import { EMPTY, X, O, ROCK } from '../src/logic/board.js';
import { STONE_CONVERSION, TERRAIN_CREATION, TORNADO_ZONE, WIND_DASH } from '../src/logic/skills.js';
import { createInitialState, isGameOver, placeStone, skillCooldown, useSkill } from '../src/logic/game.js';
import { tornadoCells } from '../src/logic/wind-rabbit-skills.js';

// Builds a playing state with cells set directly: [[x, y, value], ...].
function stateWith(cells, currentPlayer = X) {
  const state = createInitialState();
  for (const [x, y, value] of cells) state.board[y][x] = value;
  state.currentPlayer = currentPlayer;
  return state;
}

function placeResult(state, player, x, y, random) {
  const result = placeStone(state, { player, x, y }, random ? { random } : undefined);
  assert.equal(result.ok, true, result.error);
  return result;
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

// A random function that fails the test if it is called.
function noRandom() {
  assert.fail('random must not be called');
}

const types = (events) => events.map((e) => e.type);

// X stone at (3, 3) announces a dash to (6, 3) on turn 1.
const DASH = { from: { x: 3, y: 3 }, to: { x: 6, y: 3 } };

function announcedDash(cells = []) {
  const state = stateWith([[3, 3, X], ...cells]);
  return skillResult(state, X, WIND_DASH, DASH).state;
}

// --- WIND DASH: announce ---

test('Wind Dash is announced without moving the stone and uses the turn', () => {
  const state = stateWith([[3, 3, X]]);
  const result = skillResult(state, X, WIND_DASH, DASH);
  assert.equal(result.state.board[3][3], X, 'the stone has not moved yet');
  assert.equal(result.state.board[3][6], EMPTY);
  assert.deepEqual(result.state.pendingDash, { player: X, from: DASH.from, to: DASH.to, resolvesAfterTurn: 2 });
  assert.equal(result.state.currentPlayer, O);
  assert.equal(result.state.turn, 2);
  assert.equal(skillCooldown(result.state, X, WIND_DASH), COOLDOWN_SHORT);
  assert.deepEqual(result.events, [
    { type: 'skillUsed', player: X, skill: WIND_DASH, target: DASH },
    { type: 'dashAnnounced', player: X, from: DASH.from, to: DASH.to },
    { type: 'turnEnded', player: X, turn: 1 },
  ]);
  assert.equal(state.pendingDash, null, 'the given state is not mutated');
  assert.deepEqual(JSON.parse(JSON.stringify(result.state)), result.state);
});

test('Wind Dash needs one of your own stones and an empty target cell on the board', () => {
  const state = stateWith([[3, 3, X], [4, 4, O], [5, 5, ROCK], [6, 6, X]]);
  const action = (from, to) => ({ player: X, skill: WIND_DASH, target: { from, to } });
  const free = { x: 10, y: 10 };
  assertSkillRejected(state, action({ x: 0, y: 0 }, free), /your own stones/);
  assertSkillRejected(state, action({ x: 4, y: 4 }, free), /your own stones/);
  assertSkillRejected(state, action({ x: 5, y: 5 }, free), /your own stones/);
  assertSkillRejected(state, action({ x: -1, y: 3 }, free), /on the board/);
  assertSkillRejected(state, action({ x: 3, y: 3 }, { x: 6, y: 6 }), /not empty/);
  assertSkillRejected(state, action({ x: 3, y: 3 }, { x: 4, y: 4 }), /not empty/);
  assertSkillRejected(state, action({ x: 3, y: 3 }, { x: 5, y: 5 }), /not empty/);
  assertSkillRejected(state, action({ x: 3, y: 3 }, { x: 3, y: 3 }), /not empty/);
  assertSkillRejected(state, action({ x: 3, y: 3 }, { x: BOARD_SIZE, y: 0 }), /on the board/);
  assertSkillRejected(state, action({ x: 3, y: 3 }, undefined), /on the board/);
  assertSkillRejected(state, { player: X, skill: WIND_DASH, target: null }, /on the board/);
  assertSkillRejected(state, { player: X, skill: WIND_DASH }, /on the board/);
});

// --- WIND DASH: resolve ---

test('Wind Dash resolves when the opponent\'s next turn ends', () => {
  const state = announcedDash();
  const result = placeResult(state, O, 10, 10);
  assert.equal(result.state.board[3][3], EMPTY, 'the source becomes empty');
  assert.equal(result.state.board[3][6], X, 'the stone lands on the target');
  assert.equal(result.state.pendingDash, null);
  assert.equal(result.state.currentPlayer, X);
  assert.deepEqual(result.events, [
    { type: 'stonePlaced', player: O, x: 10, y: 10 },
    { type: 'dashResolved', player: X, from: DASH.from, to: DASH.to },
    { type: 'turnEnded', player: O, turn: 2 },
  ]);
});

test('Wind Dash also resolves when the opponent uses a skill on their turn', () => {
  const result = skillResult(announcedDash(), O, TERRAIN_CREATION, { x: 10, y: 10 });
  assert.equal(result.state.board[3][6], X);
  assert.equal(result.state.board[10][10], ROCK);
  assert.deepEqual(types(result.events), ['skillUsed', 'rockPlaced', 'dashResolved', 'turnEnded']);
});

test('Wind Dash fails if the opponent takes the target cell, and the cooldown still applies', () => {
  const result = placeResult(announcedDash(), O, 6, 3);
  assert.equal(result.state.board[3][3], X, 'the stone stays where it is');
  assert.equal(result.state.board[3][6], O);
  assert.equal(result.state.pendingDash, null);
  assert.deepEqual(result.events[1], { type: 'dashFailed', player: X, from: DASH.from, to: DASH.to, reason: 'targetTaken' });
  assert.equal(skillCooldown(result.state, X, WIND_DASH), COOLDOWN_SHORT);
});

test('Wind Dash fails if the opponent drops a rock on the target cell', () => {
  const result = skillResult(announcedDash(), O, TERRAIN_CREATION, { x: 6, y: 3 });
  assert.equal(result.state.board[3][3], X);
  assert.equal(result.state.board[3][6], ROCK);
  assert.equal(result.events.find((e) => e.type === 'dashFailed').reason, 'targetTaken');
});

test('Wind Dash fails if the source stone is converted', () => {
  const result = skillResult(announcedDash(), O, STONE_CONVERSION, DASH.from);
  assert.equal(result.state.board[3][3], O, 'the converted stone stays');
  assert.equal(result.state.board[3][6], EMPTY);
  assert.equal(result.state.pendingDash, null);
  assert.deepEqual(types(result.events), ['skillUsed', 'stoneConverted', 'dashFailed', 'turnEnded']);
  assert.equal(result.events[2].reason, 'sourceLost');
  assert.equal(skillCooldown(result.state, X, WIND_DASH), COOLDOWN_SHORT);
});

test('Wind Dash never resolves if the opponent wins on their turn', () => {
  const four = [0, 1, 2, 3].map((x) => [x, 12, O]);
  const result = placeResult(announcedDash(four), O, 4, 12);
  assert.equal(result.state.winner, O);
  assert.deepEqual(types(result.events), ['stonePlaced', 'win']);
  assert.equal(result.state.board[3][3], X, 'the stone did not move');
  assert.equal(result.state.board[3][6], EMPTY);
  assert.equal(result.state.pendingDash, null, 'the announced dash is dropped, so it is no longer shown');
  assert.equal(isGameOver(result.state), true);
});

test('a Wind Dash landing that makes five in a row wins for Wind Rabbit', () => {
  // X X X X at (2..5, 7); the dash moves (3, 3) into (6, 7).
  const cells = [2, 3, 4, 5].map((x) => [x, 7, X]);
  const state = stateWith([[3, 3, X], ...cells]);
  const announced = skillResult(state, X, WIND_DASH, { from: { x: 3, y: 3 }, to: { x: 6, y: 7 } }).state;
  assert.equal(announced.winner, null, 'no win while the dash is only announced');

  const result = placeResult(announced, O, 10, 10);
  assert.equal(result.state.winner, X);
  assert.deepEqual(result.state.winLine, [2, 3, 4, 5, 6].map((x) => ({ x, y: 7 })));
  assert.deepEqual(types(result.events), ['stonePlaced', 'dashResolved', 'win']);
  assert.equal(result.events[2].player, X);
  assert.equal(placeStone(result.state, { player: X, x: 0, y: 0 }).ok, false);
});

test('a Wind Dash landing that does not make five lets the game go on', () => {
  const result = placeResult(announcedDash([[4, 3, X], [5, 3, X]]), O, 10, 10);
  assert.equal(result.state.winner, null);
  assert.equal(result.state.currentPlayer, X);
});

test('a Wind Dash landing inside a Tornado Zone is not blown away: the storm comes first', () => {
  const state = announcedDash();
  state.tornado = { player: X, x: 6, y: 3, cells: tornadoCells(state.board, 6, 3), endsAfterTurn: state.turn };
  const result = placeStone(state, { player: O, x: 10, y: 10 }, { random: noRandom });
  assert.equal(result.state.board[3][6], X);
  assert.deepEqual(types(result.events), ['stonePlaced', 'tornadoStorm', 'tornadoEnded', 'dashResolved', 'turnEnded']);
});

// --- TORNADO ZONE: announce ---

test('Tornado Zone covers the 3x3 cells around the centre and uses the turn', () => {
  const state = stateWith([]);
  const result = skillResult(state, X, TORNADO_ZONE, { x: 7, y: 7 });
  const cells = [];
  for (let y = 6; y <= 8; y++) for (let x = 6; x <= 8; x++) cells.push({ x, y });
  assert.deepEqual(result.state.tornado, { player: X, x: 7, y: 7, cells, endsAfterTurn: 2 });
  assert.deepEqual(result.state.board, state.board);
  assert.equal(result.state.currentPlayer, O);
  assert.equal(skillCooldown(result.state, X, TORNADO_ZONE), COOLDOWN_LONG);
  assert.deepEqual(result.events, [
    { type: 'skillUsed', player: X, skill: TORNADO_ZONE, target: { x: 7, y: 7 } },
    { type: 'tornadoAnnounced', player: X, x: 7, y: 7, cells },
    { type: 'turnEnded', player: X, turn: 1 },
  ]);
  assert.equal(state.tornado, null, 'the given state is not mutated');
});

test('the Tornado Zone is clipped by the board edges', () => {
  const board = createInitialState().board;
  const last = BOARD_SIZE - 1;
  assert.deepEqual(tornadoCells(board, 0, 0), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
  assert.equal(tornadoCells(board, last, last).length, 4);
  assert.equal(tornadoCells(board, 7, 0).length, 6);
  assert.equal(tornadoCells(board, 0, 7).length, 6);
  assert.equal(tornadoCells(board, 7, 7).length, 9);
  const corner = skillResult(stateWith([]), X, TORNADO_ZONE, { x: last, y: 0 }).state.tornado;
  assert.deepEqual(corner.cells, [{ x: last - 1, y: 0 }, { x: last, y: 0 }, { x: last - 1, y: 1 }, { x: last, y: 1 }]);
});

test('Tornado Zone needs a centre on the board', () => {
  const state = stateWith([]);
  const action = (target) => ({ player: X, skill: TORNADO_ZONE, target });
  assertSkillRejected(state, action({ x: -1, y: 0 }), /on the board/);
  assertSkillRejected(state, action({ x: 0, y: BOARD_SIZE }), /on the board/);
  assertSkillRejected(state, action(null), /on the board/);
  assertSkillRejected(state, { player: X, skill: TORNADO_ZONE }, /on the board/);
});

// --- TORNADO ZONE: the storm ---

// Wind Rabbit puts a zone centred on (7, 7) on turn 1; Earth Bear is to move.
function activeTornado(cells = [], centre = { x: 7, y: 7 }) {
  return skillResult(stateWith(cells), X, TORNADO_ZONE, centre).state;
}

// The empty plots outside the zone in row order (the storm's choices).
function outsideEmpty(board, zone) {
  const cells = [];
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      if (board[y][x] === EMPTY && !zone.some((c) => c.x === x && c.y === y)) cells.push({ x, y });
    }
  }
  return cells;
}

test('after the opponent\'s turn every plant in the zone, of both sides and the new one, flies to a random empty plot outside', () => {
  const state = activeTornado([[6, 6, X], [8, 8, O]]);
  const zone = state.tornado.cells;
  const result = placeResult(state, O, 7, 7, () => 0);
  // Row order: (6,6) X, (7,7) O, (8,8) O; each takes the first empty plot outside the zone.
  const firsts = outsideEmpty(state.board, zone);
  assert.deepEqual(result.events.filter((e) => e.type === 'stoneThrown').map((e) => [e.player, e.from, e.to]), [
    [X, { x: 6, y: 6 }, firsts[0]],
    [O, { x: 7, y: 7 }, firsts[1]],
    [O, { x: 8, y: 8 }, firsts[2]],
  ]);
  for (const cell of zone) assert.equal(result.state.board[cell.y][cell.x], EMPTY, `${cell.x},${cell.y} cleared`);
  assert.equal(result.state.board[firsts[0].y][firsts[0].x], X);
  assert.equal(result.state.board[firsts[2].y][firsts[2].x], O);
  assert.deepEqual(types(result.events), ['stonePlaced', 'tornadoStorm', 'stoneThrown', 'stoneThrown', 'stoneThrown', 'tornadoEnded', 'turnEnded']);
  assert.deepEqual(result.events[1], { type: 'tornadoStorm', player: X, x: 7, y: 7, cells: zone, count: 3 });
  assert.equal(result.state.tornado, null);
  assert.equal(result.state.currentPlayer, X);
});

test('the storm also comes when the opponent uses a skill or plants outside; rocks stay', () => {
  const skillTurn = skillResult(activeTornado([[6, 6, X], [8, 6, ROCK]]), O, TERRAIN_CREATION, { x: 7, y: 7 });
  assert.equal(skillTurn.state.board[7][7], ROCK, 'the new rock stays');
  assert.equal(skillTurn.state.board[6][8], ROCK);
  assert.equal(skillTurn.state.board[6][6], EMPTY, 'the plant flew');
  assert.equal(skillTurn.state.tornado, null);

  const outside = placeResult(activeTornado([[6, 7, X]]), O, 12, 12, () => 0.999);
  assert.equal(outside.state.board[12][12], O, 'a plant outside the zone stays');
  assert.equal(outside.state.board[7][6], EMPTY);
});

test('the random picks the landing plot; plants never share one, and none lands in the zone', () => {
  for (const r of [0, 0.37, 0.999]) {
    const result = placeResult(activeTornado([[6, 6, X], [7, 6, X], [8, 6, O]]), O, 7, 7, () => r);
    const landed = result.events.filter((e) => e.type === 'stoneThrown').map((e) => `${e.to.x},${e.to.y}`);
    assert.equal(new Set(landed).size, 4);
    for (const key of landed) {
      const [x, y] = key.split(',').map(Number);
      assert.ok(Math.abs(x - 7) > 1 || Math.abs(y - 7) > 1, `${key} is outside the zone`);
    }
  }
});

test('a plant with no empty plot outside the zone stays where it is', () => {
  const state = activeTornado();
  for (let y = 0; y < BOARD_SIZE; y++) for (let x = 0; x < BOARD_SIZE; x++) {
    if (Math.abs(x - 7) > 1 || Math.abs(y - 7) > 1) state.board[y][x] = ROCK;
  }
  const result = placeStone(state, { player: O, x: 7, y: 7 }, { random: noRandom });
  assert.equal(result.state.board[7][7], O);
  assert.deepEqual(types(result.events).slice(0, 3), ['stonePlaced', 'tornadoStorm', 'throwBlocked']);
});

test('two turns later the old zone is plain soil again', () => {
  const skillTurn = skillResult(activeTornado(), O, TERRAIN_CREATION, { x: 0, y: 0 });
  const xTurn = placeResult(skillTurn.state, X, 0, 14).state;
  const later = placeStone(xTurn, { player: O, x: 6, y: 6 }, { random: noRandom });
  assert.equal(later.state.board[6][6], O);
});

test('without an injected random the storm still lands every plant on an empty plot outside', () => {
  const result = placeResult(activeTornado([[6, 6, X]]), O, 7, 7);
  for (const event of result.events.filter((e) => e.type === 'stoneThrown')) {
    assert.ok(Math.abs(event.to.x - 7) > 1 || Math.abs(event.to.y - 7) > 1);
    assert.equal(result.state.board[event.to.y][event.to.x], event.player);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(result.state)), result.state);
});

// --- TORNADO ZONE: win check after the storm ---

test('a placement in the zone that would make five is not a win: it is blown away', () => {
  const cells = [2, 3, 4, 5].map((x) => [x, 7, O]);
  const result = placeResult(activeTornado(cells), O, 6, 7, () => 0);
  assert.equal(result.state.board[7][6], EMPTY);
  assert.equal(result.state.winner, null);
});

test('plants blown away break a five that used the zone, and a plant outside that needed them does not win', () => {
  // O O O O at (8..11, 7) with (7, 7) in the zone: O plants (12, 7) but the
  // storm takes (8, 7) away first, so there is no five.
  const cells = [[8, 7, O], [9, 7, O], [10, 7, O], [11, 7, O]];
  const result = placeResult(activeTornado(cells), O, 12, 7, () => 0.999);
  assert.equal(result.state.board[7][8], EMPTY);
  assert.equal(result.state.winner, null);
});

test('a plant the storm drops into a five wins for its owner', () => {
  // X X X X at (0..3, 0): the first empty plot outside the zone is (4, 0),
  // so the X at (6, 6) lands there and makes five for X, on O's turn.
  const cells = [0, 1, 2, 3].map((x) => [x, 0, X]).concat([[6, 6, X]]);
  const result = placeResult(activeTornado(cells), O, 12, 12, () => 0);
  assert.equal(result.state.winner, X);
  assert.deepEqual(result.state.winLine, [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 })));
  assert.equal(result.events.at(-1).type, 'win');
});

test('fives for both players from one storm are a draw', () => {
  // X X X X at (0..3, 0) and O O O O at (0..3, 1); rocks fill the rest of
  // row 0, so in row order the X from (6, 6) lands on (4, 0) and the O from
  // (8, 8) on (4, 1): both make five at once.
  const cells = [0, 1, 2, 3].map((x) => [x, 0, X]);
  for (let x = 5; x < BOARD_SIZE; x++) cells.push([x, 0, ROCK]);
  for (let x = 0; x < 4; x++) cells.push([x, 1, O]);
  cells.push([6, 6, X], [8, 8, O]);
  const result = placeResult(activeTornado(cells), O, 14, 14, () => 0);
  assert.equal(result.state.board[0][4], X);
  assert.equal(result.state.board[1][4], O);
  assert.equal(result.state.draw, true);
  assert.equal(result.state.winner, null);
  assert.equal(result.events.at(-1).type, 'draw');
  assert.equal(isGameOver(result.state), true);
});

test('the zone is gone once the opponent wins on its turn', () => {
  const four = [0, 1, 2, 3].map((x) => [x, 12, O]);
  const result = placeStone(activeTornado(four), { player: O, x: 4, y: 12 }, { random: noRandom });
  assert.equal(result.state.winner, O);
  assert.equal(result.state.tornado, null);
});
