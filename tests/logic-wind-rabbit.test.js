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

test('a Wind Dash landing inside a Tornado Zone is not thrown', () => {
  const state = announcedDash();
  state.tornado = { player: X, x: 6, y: 3, cells: tornadoCells(state.board, 6, 3), endsAfterTurn: state.turn };
  const result = placeStone(state, { player: O, x: 10, y: 10 }, { random: noRandom });
  assert.equal(result.state.board[3][6], X);
  assert.deepEqual(types(result.events), ['stonePlaced', 'dashResolved', 'tornadoEnded', 'turnEnded']);
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

// --- TORNADO ZONE: throw ---

// Wind Rabbit puts a zone centred on (7, 7) on turn 1; Earth Bear is to move.
function activeTornado(cells = [], centre = { x: 7, y: 7 }) {
  return skillResult(stateWith(cells), X, TORNADO_ZONE, centre).state;
}

test('a stone placed in the zone is thrown to the neighbour picked by the injected random', () => {
  // Neighbours are listed in row order: (6,6) first, (8,8) last.
  const first = placeResult(activeTornado(), O, 7, 7, () => 0);
  assert.equal(first.state.board[7][7], EMPTY);
  assert.equal(first.state.board[6][6], O);
  assert.deepEqual(first.events, [
    { type: 'stonePlaced', player: O, x: 7, y: 7 },
    { type: 'stoneThrown', player: O, from: { x: 7, y: 7 }, to: { x: 6, y: 6 } },
    { type: 'tornadoEnded', player: X, x: 7, y: 7 },
    { type: 'turnEnded', player: O, turn: 2 },
  ]);
  assert.equal(first.state.tornado, null);

  const last = placeResult(activeTornado(), O, 7, 7, () => 0.999);
  assert.equal(last.state.board[8][8], O);

  const middle = placeResult(activeTornado(), O, 7, 7, () => 0.5); // index 4 of 8: (8, 7)
  assert.equal(middle.state.board[7][8], O);
});

test('the throw only picks empty neighbours: stones, rocks and off-board cells are skipped', () => {
  // Zone at the corner; the stone lands on (0, 0). Of its neighbours (1, 0)
  // holds a stone and (0, 1) a rock, so (1, 1) is the only choice.
  const state = activeTornado([[1, 0, X], [0, 1, ROCK]], { x: 0, y: 0 });
  for (const r of [0, 0.5, 0.999]) {
    const result = placeResult(state, O, 0, 0, () => r);
    assert.deepEqual(result.events[1].to, { x: 1, y: 1 });
    assert.equal(result.state.board[1][1], O);
    assert.equal(result.state.board[0][1], X);
    assert.equal(result.state.board[1][0], ROCK);
  }
});

test('a stone with no empty neighbour stays where it was placed', () => {
  const around = [];
  for (let y = 6; y <= 8; y++) for (let x = 6; x <= 8; x++) if (x !== 7 || y !== 7) around.push([x, y, (x + y) % 2 ? X : ROCK]);
  const result = placeStone(activeTornado(around), { player: O, x: 7, y: 7 }, { random: noRandom });
  assert.equal(result.ok, true);
  assert.equal(result.state.board[7][7], O);
  assert.deepEqual(types(result.events), ['stonePlaced', 'throwBlocked', 'tornadoEnded', 'turnEnded']);
});

test('a thrown stone is never thrown again, even if it lands inside the zone', () => {
  let calls = 0;
  const result = placeResult(activeTornado(), O, 7, 7, () => {
    calls++;
    return 0;
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.events[1].to, { x: 6, y: 6 }, 'landed inside the zone');
  assert.equal(result.events.filter((e) => e.type === 'stoneThrown').length, 1);
  assert.equal(result.state.board[6][6], O);
});

test('a stone placed outside the zone is not thrown', () => {
  const result = placeStone(activeTornado(), { player: O, x: 9, y: 7 }, { random: noRandom });
  assert.equal(result.state.board[7][9], O);
  assert.deepEqual(types(result.events), ['stonePlaced', 'tornadoEnded', 'turnEnded']);
});

test('the zone lasts through the opponent\'s next turn only', () => {
  // Earth Bear uses a skill on that turn: the rock is not thrown, and the
  // zone disappears at the end of the turn anyway.
  const skillTurn = skillResult(activeTornado(), O, TERRAIN_CREATION, { x: 7, y: 7 });
  assert.equal(skillTurn.state.board[7][7], ROCK);
  assert.equal(skillTurn.state.tornado, null);
  assert.deepEqual(types(skillTurn.events), ['skillUsed', 'rockPlaced', 'tornadoEnded', 'turnEnded']);

  // Two turns later a stone placed in the old zone stays.
  const xTurn = placeResult(skillTurn.state, X, 0, 14).state;
  const later = placeStone(xTurn, { player: O, x: 6, y: 6 }, { random: noRandom });
  assert.equal(later.state.board[6][6], O);
});

test('the zone does not affect Stone Conversion', () => {
  const result = skillResult(activeTornado([[7, 7, X]]), O, STONE_CONVERSION, { x: 7, y: 7 });
  assert.equal(result.state.board[7][7], O);
  assert.deepEqual(types(result.events), ['skillUsed', 'stoneConverted', 'tornadoEnded', 'turnEnded']);
});

test('without an injected random the throw still lands on an empty neighbour', () => {
  const result = placeResult(activeTornado(), O, 7, 7);
  const { to } = result.events[1];
  assert.equal(Math.abs(to.x - 7) <= 1 && Math.abs(to.y - 7) <= 1, true);
  assert.equal(result.state.board[to.y][to.x], O);
  assert.equal(result.state.board[7][7], EMPTY);
  assert.deepEqual(JSON.parse(JSON.stringify(result.state)), result.state);
});

// --- TORNADO ZONE: win check after the throw ---

test('a thrown stone that lands to make five in a row wins for the player who placed it', () => {
  // O O O O at (2..5, 6); O places (6, 7) in the zone and random throws it to (6, 6).
  const cells = [2, 3, 4, 5].map((x) => [x, 6, O]);
  const result = placeResult(activeTornado(cells), O, 6, 7, () => 0); // first empty neighbour of (6,7) is (6,6)
  assert.deepEqual(result.events[1].to, { x: 6, y: 6 });
  assert.equal(result.state.winner, O);
  assert.deepEqual(result.state.winLine, [2, 3, 4, 5, 6].map((x) => ({ x, y: 6 })));
  assert.deepEqual(types(result.events), ['stonePlaced', 'stoneThrown', 'win']);
});

test('a placement that would make five is not a win if the stone is thrown away', () => {
  // O O O O at (2..5, 7); O places (6, 7), completing five, but it is thrown to (5, 6).
  const cells = [2, 3, 4, 5].map((x) => [x, 7, O]);
  const result = placeResult(activeTornado(cells), O, 6, 7, () => 0);
  assert.deepEqual(result.events[1].to, { x: 5, y: 6 });
  assert.equal(result.state.board[7][6], EMPTY);
  assert.equal(result.state.winner, null);
  assert.equal(result.state.currentPlayer, X);
});

test('a stone that cannot be thrown still wins if it makes five where it was placed', () => {
  const cells = [2, 3, 4, 5].map((x) => [x, 7, O]);
  for (let y = 6; y <= 8; y++) for (let x = 5; x <= 7; x++) if (y !== 7) cells.push([x, y, ROCK]);
  cells.push([7, 7, ROCK]);
  const result = placeStone(activeTornado(cells), { player: O, x: 6, y: 7 }, { random: noRandom });
  assert.equal(result.state.winner, O);
  assert.deepEqual(types(result.events), ['stonePlaced', 'throwBlocked', 'win']);
});
