import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, COOLDOWN_LONG, COOLDOWN_SHORT, TORNADO_ARM, TORNADO_TURNS, WIND_DASH_RANGE } from '../src/config.js';
import { EMPTY, X, O, ROCK } from '../src/logic/board.js';
import { PETRIFICATION, MUD_TRAP, TORNADO_ZONE, WIND_DASH } from '../src/logic/skills.js';
import { createInitialState, isGameOver, placeStone, skillCooldown, useSkill } from '../src/logic/game.js';
import { tornadoCells } from '../src/logic/wind-rabbit-skills.js';
import { skillTurn } from './skill-turn.js';

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

// The cell where the caster plants to end the turn of a skill (Free Action).
const SPARE = { x: 14, y: 14 };

// The dash is announced and X planted a seed to end turn 1: O is to move.
function announcedDash(cells = []) {
  const state = stateWith([[3, 3, X], ...cells]);
  return skillTurn(state, X, WIND_DASH, DASH, SPARE);
}

// --- WIND DASH: announce ---

test('Wind Dash is announced without moving the stone and does not end the turn', () => {
  const state = stateWith([[3, 3, X]]);
  const result = skillResult(state, X, WIND_DASH, DASH);
  assert.equal(result.state.board[3][3], X, 'the stone has not moved yet');
  assert.equal(result.state.board[3][6], EMPTY);
  assert.deepEqual(result.state.pendingDash, { player: X, from: DASH.from, to: DASH.to, resolvesAfterTurn: 2 });
  assert.equal(result.state.currentPlayer, X, 'X still has to plant');
  assert.equal(result.state.turn, 1);
  assert.equal(skillCooldown(result.state, X, WIND_DASH), COOLDOWN_SHORT, 'the full cooldown starts at once');
  assert.deepEqual(result.events, [
    { type: 'skillUsed', player: X, skill: WIND_DASH, target: DASH },
    { type: 'dashAnnounced', player: X, from: DASH.from, to: DASH.to },
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

const TOO_FAR = /^That cell is too far for Wind Dash\.$/;

test('Wind Dash range: 1 to WIND_DASH_RANGE cells (Chebyshev, diagonals included) is allowed, farther is refused', () => {
  assert.equal(WIND_DASH_RANGE, 3);
  const R = WIND_DASH_RANGE;
  const state = stateWith([[7, 7, X]]);
  const dash = (x, y) => ({ player: X, skill: WIND_DASH, target: { from: { x: 7, y: 7 }, to: { x, y } } });
  // The last cell of the 7 by 7 square in every direction, and a knight-like offset.
  const near = [[7 + R, 7], [7 - R, 7], [7, 7 + R], [7, 7 - R], [7 + R, 7 + R], [7 - R, 7 - R], [7 + R, 7 - R], [7 - R, 7 + R], [7 + R, 7 + 1], [7 + 1, 7 - R], [8, 7]];
  for (const [x, y] of near) {
    const result = skillResult(state, X, WIND_DASH, dash(x, y).target);
    assert.deepEqual(result.state.pendingDash.to, { x, y }, `(${x}, ${y}) is in range`);
  }
  const far = [[7 + R + 1, 7], [7 - R - 1, 7], [7, 7 + R + 1], [7, 7 - R - 1], [7 + R + 1, 7 + R + 1], [7 + R + 1, 7 + 1], [7 + 1, 7 - R - 1], [7 - R - 1, 7 - 2]];
  for (const [x, y] of far) assertSkillRejected(state, dash(x, y), TOO_FAR);
  assertSkillRejected(state, dash(7, 7), /not empty/); // distance 0 is the source itself, which holds the plant
  // A cell far away on the board is refused as too far, not as anything else.
  assertSkillRejected(state, dash(0, 0), TOO_FAR);
  assertSkillRejected(state, dash(BOARD_SIZE - 1, BOARD_SIZE - 1), TOO_FAR);
});

test('Wind Dash cannot target mud or a poisoned cell; a missing poison field means no poison', () => {
  const state = stateWith([[3, 3, X]]);
  const toward = (x, y) => ({ player: X, skill: WIND_DASH, target: { from: { x: 3, y: 3 }, to: { x, y } } });
  assert.equal('poison' in state, false, 'the state has no poison field yet');
  skillResult(state, X, WIND_DASH, toward(5, 3).target); // no field, no poison
  state.poison = null;
  skillResult(state, X, WIND_DASH, toward(5, 3).target);

  state.mud = [{ x: 5, y: 3, player: O, driesAfterTurn: 9 }];
  assertSkillRejected(state, toward(5, 3), /^A Wind Dash cannot land on mud\.$/);
  skillResult(state, X, WIND_DASH, toward(5, 4).target);

  state.poison = { player: O, x: 5, y: 5, cells: [4, 5, 6].flatMap((x) => [4, 5, 6].map((y) => ({ x, y }))), endsAfterTurn: 9 };
  assertSkillRejected(state, toward(5, 5), /^A Wind Dash cannot land on poison\.$/);
  assertSkillRejected(state, toward(4, 4), /poison/);
  skillResult(state, X, WIND_DASH, toward(3, 5).target); // outside the zone
});

test('Wind Dash cannot start from a seed sunk in mud', () => {
  const state = stateWith([[3, 3, X], [4, 4, X]]);
  state.sunk = [{ x: 3, y: 3, player: X, surfacesAfterTurn: 9 }];
  assertSkillRejected(state, { player: X, skill: WIND_DASH, target: { from: { x: 3, y: 3 }, to: { x: 5, y: 3 } } }, /^That plant is sunk in mud\.$/);
  skillResult(state, X, WIND_DASH, { from: { x: 4, y: 4 }, to: { x: 5, y: 3 } }); // another plant may
});

// --- WIND DASH: resolve ---

test('a Wind Dash cast and then a planting resolves when the opponent\'s next turn ends', () => {
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
  // The caster's own planting in the cast turn did not resolve it.
  assert.deepEqual(announcedDash().pendingDash, { player: X, from: DASH.from, to: DASH.to, resolvesAfterTurn: 2 });
});

test('Wind Dash also resolves when the opponent uses a skill and plants on their turn', () => {
  const used = skillResult(announcedDash(), O, MUD_TRAP, { x: 10, y: 10 });
  assert.equal(used.state.board[3][6], EMPTY, 'a skill alone does not end the turn, so the dash waits');
  assert.deepEqual(types(used.events), ['skillUsed', 'mudPlaced']);
  const result = placeResult(used.state, O, 12, 12);
  assert.equal(result.state.board[3][6], X);
  assert.equal(result.state.board[10][10], EMPTY, 'a puddle is no stone');
  assert.equal(result.state.mud.length, 1);
  assert.deepEqual(types(result.events), ['stonePlaced', 'dashResolved', 'turnEnded']);
});

test('Wind Dash fails if the opponent takes the target cell, and the cooldown still applies', () => {
  const result = placeResult(announcedDash(), O, 6, 3);
  assert.equal(result.state.board[3][3], X, 'the stone stays where it is');
  assert.equal(result.state.board[3][6], O);
  assert.equal(result.state.pendingDash, null);
  assert.deepEqual(result.events[1], { type: 'dashFailed', player: X, from: DASH.from, to: DASH.to, reason: 'targetTaken' });
  assert.equal(skillCooldown(result.state, X, WIND_DASH), COOLDOWN_SHORT);
});

test('Wind Dash fails if the opponent floods the target cell with mud (a dash cannot land on mud)', () => {
  const used = skillResult(announcedDash(), O, MUD_TRAP, { x: 6, y: 3 });
  const result = placeResult(used.state, O, 12, 12);
  assert.equal(result.state.board[3][3], X);
  assert.equal(result.state.board[3][6], EMPTY);
  assert.equal(result.events.find((e) => e.type === 'dashFailed').reason, 'targetTaken');
});

test('Wind Dash fails if the target becomes poisoned before it resolves', () => {
  const state = announcedDash();
  state.poison = { player: O, x: 6, y: 3, cells: [{ x: 6, y: 3 }], endsAfterTurn: 9 };
  const result = placeResult(state, O, 12, 12);
  assert.equal(result.state.board[3][3], X);
  assert.equal(result.state.board[3][6], EMPTY);
  assert.deepEqual(result.events[1], { type: 'dashFailed', player: X, from: DASH.from, to: DASH.to, reason: 'targetTaken' });
});

test('Wind Dash fails with sourceLost if the source is sunk when it resolves', () => {
  const state = announcedDash();
  state.sunk = [{ x: 3, y: 3, player: X, surfacesAfterTurn: 99 }];
  const result = placeResult(state, O, 12, 12);
  assert.equal(result.state.board[3][3], X, 'the sunk seed stays');
  assert.equal(result.state.board[3][6], EMPTY);
  assert.deepEqual(result.events[1], { type: 'dashFailed', player: X, from: DASH.from, to: DASH.to, reason: 'sourceLost' });
});

test('Wind Dash fails if the source stone is petrified', () => {
  const used = skillResult(announcedDash(), O, PETRIFICATION, DASH.from);
  assert.deepEqual(types(used.events), ['skillUsed', 'stonePetrified']);
  const result = placeResult(used.state, O, 12, 12);
  assert.equal(result.state.board[3][3], ROCK, 'the rock stays');
  assert.equal(result.state.board[3][6], EMPTY);
  assert.equal(result.state.pendingDash, null);
  assert.deepEqual(types(result.events), ['stonePlaced', 'dashFailed', 'turnEnded']);
  assert.equal(result.events[1].reason, 'sourceLost');
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
  // X X X X at (2..5, 7); the dash moves (4, 5) into (6, 7).
  const cells = [2, 3, 4, 5].map((x) => [x, 7, X]);
  const state = stateWith([[4, 5, X], ...cells]);
  const announced = skillTurn(state, X, WIND_DASH, { from: { x: 4, y: 5 }, to: { x: 6, y: 7 } }, SPARE);
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

test('a Wind Dash landing on a cell of an armed Tornado Zone cross does not fire it', () => {
  const state = announcedDash();
  state.tornado = { player: O, x: 6, y: 3, cells: tornadoCells(state.board, 6, 3), armedAfterTurn: 1, endsAfterTurn: 1 + TORNADO_TURNS };
  const result = placeStone(state, { player: O, x: 10, y: 10 }, { random: noRandom });
  assert.equal(result.state.board[3][6], X);
  assert.deepEqual(types(result.events), ['stonePlaced', 'dashResolved', 'turnEnded']);
  assert.notEqual(result.state.tornado, null, 'only a planting fires the trap');
});


// --- TORNADO ZONE: the cross ---

const at = (x, y) => ({ x, y });

test('Tornado Zone is a cross of 5 plots, armed from the end of the cast turn, and does not end the turn', () => {
  assert.equal(TORNADO_ARM, 1);
  assert.equal(TORNADO_TURNS, 2);
  const state = stateWith([]);
  const result = skillResult(state, X, TORNADO_ZONE, { x: 7, y: 7 });
  const cells = [at(7, 6), at(6, 7), at(7, 7), at(8, 7), at(7, 8)];
  assert.deepEqual(result.state.tornado, { player: X, x: 7, y: 7, cells, armedAfterTurn: 1, endsAfterTurn: 1 + TORNADO_TURNS });
  assert.deepEqual(result.state.board, state.board);
  assert.equal(result.state.currentPlayer, X, 'X still has to plant');
  assert.equal(skillCooldown(result.state, X, TORNADO_ZONE), COOLDOWN_LONG);
  assert.deepEqual(result.events, [
    { type: 'skillUsed', player: X, skill: TORNADO_ZONE, target: { x: 7, y: 7 } },
    { type: 'tornadoAnnounced', player: X, x: 7, y: 7, cells },
  ]);
  assert.equal(state.tornado, null, 'the given state is not mutated');
  // Cast later in the game, the turns count from the cast turn.
  const later = { ...stateWith([]), turn: 5 };
  assert.deepEqual(skillResult(later, X, TORNADO_ZONE, { x: 7, y: 7 }).state.tornado, { player: X, x: 7, y: 7, cells, armedAfterTurn: 5, endsAfterTurn: 5 + TORNADO_TURNS });
});

test('the cross has its 4 arms and centre in the middle, is cut at an edge and at a corner', () => {
  const board = createInitialState().board;
  const last = BOARD_SIZE - 1;
  assert.deepEqual(tornadoCells(board, 7, 7), [at(7, 6), at(6, 7), at(7, 7), at(8, 7), at(7, 8)]);
  assert.deepEqual(tornadoCells(board, 7, 0), [at(6, 0), at(7, 0), at(8, 0), at(7, 1)], 'top edge');
  assert.deepEqual(tornadoCells(board, 0, 7), [at(0, 6), at(0, 7), at(1, 7), at(0, 8)], 'left edge');
  assert.deepEqual(tornadoCells(board, last, 7), [at(last, 6), at(last - 1, 7), at(last, 7), at(last, 8)], 'right edge');
  assert.deepEqual(tornadoCells(board, 7, last), [at(7, last - 1), at(6, last), at(7, last), at(8, last)], 'bottom edge');
  assert.deepEqual(tornadoCells(board, 0, 0), [at(0, 0), at(1, 0), at(0, 1)], 'corner');
  assert.deepEqual(tornadoCells(board, last, 0), [at(last - 1, 0), at(last, 0), at(last, 1)]);
  assert.deepEqual(tornadoCells(board, 0, last), [at(0, last - 1), at(0, last), at(1, last)]);
  assert.deepEqual(tornadoCells(board, last, last), [at(last, last - 1), at(last - 1, last), at(last, last)]);
  for (const cell of tornadoCells(board, 7, 7)) assert.ok(cell.x === 7 || cell.y === 7, 'no diagonal neighbour');
  const corner = skillResult(stateWith([]), X, TORNADO_ZONE, { x: last, y: 0 }).state.tornado;
  assert.deepEqual(corner.cells, [at(last - 1, 0), at(last, 0), at(last, 1)]);
  assert.deepEqual(corner.x, last);
});

test('Tornado Zone needs a centre on the board, and may be cast on an occupied cell', () => {
  const state = stateWith([[4, 4, O]]);
  const action = (target) => ({ player: X, skill: TORNADO_ZONE, target });
  assertSkillRejected(state, action({ x: -1, y: 0 }), /on the board/);
  assertSkillRejected(state, action({ x: 0, y: BOARD_SIZE }), /on the board/);
  assertSkillRejected(state, action(null), /on the board/);
  assertSkillRejected(state, { player: X, skill: TORNADO_ZONE }, /on the board/);
  assert.equal(skillResult(state, X, TORNADO_ZONE, { x: 4, y: 4 }).state.tornado.cells.length, 5);
});

// --- TORNADO ZONE: arming, firing and the throw ---

// Wind Rabbit puts a cross centred on (7, 7) on turn 1 and plants a seed to
// end the turn; Earth Bear is to move on turn 2.
function activeTornado(cells = [], centre = { x: 7, y: 7 }, spare = SPARE) {
  return skillTurn(stateWith(cells), X, TORNADO_ZONE, centre, spare);
}

// The free neighbours (empty, not mud, not poisoned) of (x, y) in the
// throw's order: row by row.
function freeNeighbours(state, x, y) {
  const cells = [];
  for (let cy = y - 1; cy <= y + 1; cy++) {
    for (let cx = x - 1; cx <= x + 1; cx++) {
      const inside = cy >= 0 && cy < BOARD_SIZE && cx >= 0 && cx < BOARD_SIZE;
      if (!inside || (cx === x && cy === y)) continue;
      const mud = (state.mud ?? []).some((p) => p.x === cx && p.y === cy);
      const poison = (state.poison?.cells ?? []).some((p) => p.x === cx && p.y === cy);
      if (state.board[cy][cx] === EMPTY && !mud && !poison) cells.push(at(cx, cy));
    }
  }
  return cells;
}

// Rocks on all 8 neighbours of (x, y) except the ones in `keep`.
function wall(state, x, y, keep = []) {
  for (let cy = y - 1; cy <= y + 1; cy++) {
    for (let cx = x - 1; cx <= x + 1; cx++) {
      if ((cx !== x || cy !== y) && !keep.some((k) => k.x === cx && k.y === cy)) state.board[cy][cx] = ROCK;
    }
  }
  return state;
}

test('arming: the caster\'s planting in the cast turn does not fire the trap, even on the centre', () => {
  const state = activeTornado([], { x: 7, y: 7 }, { x: 7, y: 7 });
  assert.equal(state.board[7][7], X, 'the seed stays where it was planted');
  assert.deepEqual(state.tornado.cells.length, 5);
  assert.equal(state.tornado.armedAfterTurn, 1);
  const events = [];
  skillTurn(stateWith([]), X, TORNADO_ZONE, { x: 7, y: 7 }, { x: 8, y: 7 }, events);
  assert.deepEqual(types(events), ['skillUsed', 'tornadoAnnounced', 'stonePlaced', 'turnEnded'], 'no storm in the cast turn');
});

test('the opponent\'s next planting on the cross fires it: the seed is thrown to a free neighbour', () => {
  const state = activeTornado([[6, 6, X]]);
  const choices = freeNeighbours(state, 7, 7);
  assert.equal(choices.length, 7, 'the 8 neighbours minus the plant on (6, 6)');
  const first = placeResult(state, O, 7, 7, () => 0);
  assert.equal(first.state.board[7][7], EMPTY);
  assert.equal(first.state.board[choices[0].y][choices[0].x], O);
  assert.equal(first.state.board[6][6], X, 'other plants stay');
  assert.deepEqual(first.events, [
    { type: 'stonePlaced', player: O, x: 7, y: 7 },
    { type: 'tornadoStorm', player: X, x: 7, y: 7, cells: state.tornado.cells },
    { type: 'stoneThrown', player: O, from: { x: 7, y: 7 }, to: choices[0] },
    { type: 'turnEnded', player: O, turn: 2 },
  ]);
  const last = placeResult(state, O, 7, 7, () => 0.9999);
  assert.deepEqual(last.events[2].to, choices.at(-1));
  const clamped = placeResult(state, O, 7, 7, () => 1);
  assert.deepEqual(clamped.events[2].to, choices.at(-1), 'a random of 1 is clamped to the last choice');
  for (const r of [0.13, 0.5, 0.77]) {
    const { from, to } = placeResult(state, O, 8, 7, () => r).events[2];
    assert.deepEqual(from, { x: 8, y: 7 }, 'an arm cell fires it too');
    assert.ok(Math.abs(to.x - from.x) <= 1 && Math.abs(to.y - from.y) <= 1 && (to.x !== from.x || to.y !== from.y), 'always a neighbour of the planted cell');
  }
});

test('the caster\'s next planting on the cross fires it too, and the storm event carries the whole cross', () => {
  const state = placeResult(activeTornado(), O, 0, 0).state; // O plants away
  assert.ok(state.tornado, 'still waiting in the caster\'s next turn');
  const result = placeResult(state, X, 6, 7, () => 0);
  assert.deepEqual(types(result.events), ['stonePlaced', 'tornadoStorm', 'stoneThrown', 'turnEnded']);
  assert.deepEqual(result.events[1], { type: 'tornadoStorm', player: X, x: 7, y: 7, cells: state.tornado.cells });
  assert.equal(result.state.board[7][6], EMPTY);
  assert.equal(result.events[2].player, X, 'the thrown seed is the caster\'s own');
  assert.equal(result.state.tornado, null);
});

test('a seed planted off the cross, or a skill used, does not fire it', () => {
  const outside = placeStone(activeTornado(), { player: O, x: 9, y: 7 }, { random: noRandom });
  assert.equal(outside.state.board[7][9], O);
  assert.deepEqual(types(outside.events), ['stonePlaced', 'turnEnded']);
  assert.notEqual(outside.state.tornado, null);
  for (const [x, y] of [[6, 6], [8, 8], [6, 8], [8, 6], [5, 7], [9, 7], [7, 5], [7, 9]]) {
    const result = placeStone(activeTornado(), { player: O, x, y }, { random: noRandom });
    assert.equal(result.state.board[y][x], O, `(${x}, ${y}) is off the cross`);
  }
  const used = skillResult(activeTornado(), O, MUD_TRAP, { x: 7, y: 7 });
  assert.equal(used.state.mud.length, 1);
  assert.notEqual(used.state.tornado, null, 'a skill alone does not touch the trap');
});

test('one use: the trap is used up at once, the next seed on the old cross stays', () => {
  const fired = placeResult(activeTornado(), O, 7, 7, () => 0);
  assert.equal(fired.state.tornado, null, 'used up');
  assert.equal(types(fired.events).includes('tornadoEnded'), false, 'used up is not expired');
  const next = placeStone(placeResult(fired.state, X, 0, 14).state, { player: O, x: 8, y: 7 }, { random: noRandom });
  assert.equal(next.state.board[7][8], O);
  assert.deepEqual(types(next.events), ['stonePlaced', 'turnEnded']);
});

test('throw candidates exclude occupied, mud and poisoned plots', () => {
  const state = activeTornado([[6, 6, X], [8, 6, O], [6, 8, ROCK]]);
  state.mud = [{ x: 7, y: 6, player: O, driesAfterTurn: 9 }];
  state.poison = { player: O, x: 8, y: 8, cells: [at(8, 8), at(8, 7)], endsAfterTurn: 9 };
  const choices = freeNeighbours(state, 7, 7);
  assert.deepEqual(choices, [at(6, 7), at(7, 8)], 'only (6, 7) and (7, 8) are free');
  for (const r of [0, 0.4, 0.5, 0.99]) {
    const result = placeResult(state, O, 7, 7, () => r);
    assert.ok(choices.some((c) => c.x === result.events[2].to.x && c.y === result.events[2].to.y));
    assert.equal(result.state.sunk.length, 0, 'a thrown seed lands on dry ground, nothing sinks');
  }
  assert.deepEqual(placeResult(state, O, 7, 7, () => 0).events[2].to, at(6, 7));
  assert.deepEqual(placeResult(state, O, 7, 7, () => 0.9).events[2].to, at(7, 8));
});

test('a cross at the edge only throws to neighbours on the board', () => {
  const state = activeTornado([], { x: 7, y: 1 }); // the cross reaches (7, 0)
  const choices = freeNeighbours(state, 7, 0);
  assert.equal(choices.length, 5);
  for (let i = 0; i < 5; i++) {
    const { to } = placeResult(state, O, 7, 0, () => i / 5).events[2];
    assert.ok(to.y >= 0 && to.y <= 1 && to.x >= 6 && to.x <= 8);
  }
});

test('with no free neighbour the seed stays where it was planted (throwBlocked)', () => {
  const state = wall(activeTornado(), 7, 7);
  const result = placeStone(state, { player: O, x: 7, y: 7 }, { random: noRandom });
  assert.equal(result.state.board[7][7], O);
  assert.equal(result.state.tornado, null, 'the trap is used up all the same');
  assert.deepEqual(result.events, [
    { type: 'stonePlaced', player: O, x: 7, y: 7 },
    { type: 'tornadoStorm', player: X, x: 7, y: 7, cells: state.tornado.cells },
    { type: 'throwBlocked', player: O, x: 7, y: 7 },
    { type: 'turnEnded', player: O, turn: 2 },
  ]);
  // Mud and poison close the free plots as well.
  const mixed = activeTornado([[6, 6, X], [8, 6, X], [6, 8, X], [8, 8, X]]);
  mixed.mud = [at(7, 6), at(6, 7)].map(({ x, y }) => ({ x, y, player: O, driesAfterTurn: 9 }));
  mixed.poison = { player: O, x: 7, y: 8, cells: [at(7, 8), at(8, 7)], endsAfterTurn: 9 };
  assert.deepEqual(freeNeighbours(mixed, 7, 7), []);
  const stays = placeStone(mixed, { player: O, x: 7, y: 7 }, { random: noRandom });
  assert.equal(stays.state.board[7][7], O);
  assert.ok(types(stays.events).includes('throwBlocked'));
});

test('a seed that stays on a mud cell sinks; a seed thrown off a mud cell leaves the puddle', () => {
  const blocked = wall(activeTornado(), 7, 7);
  blocked.mud = [{ x: 7, y: 7, player: X, driesAfterTurn: 9 }];
  const sunk = placeStone(blocked, { player: O, x: 7, y: 7 }, { random: noRandom });
  assert.deepEqual(types(sunk.events), ['stonePlaced', 'tornadoStorm', 'throwBlocked', 'stoneSunk', 'turnEnded']);
  assert.equal(sunk.state.sunk.length, 1);
  assert.equal(sunk.state.mud.length, 0, 'the puddle is used up');

  const open = activeTornado();
  open.mud = [{ x: 7, y: 7, player: X, driesAfterTurn: 9 }];
  const thrown = placeStone(open, { player: O, x: 7, y: 7 }, { random: () => 0 });
  assert.deepEqual(types(thrown.events), ['stonePlaced', 'tornadoStorm', 'stoneThrown', 'turnEnded']);
  assert.equal(thrown.state.sunk.length, 0, 'it flew away before it could sink');
  assert.equal(thrown.state.mud.length, 1, 'the puddle is still there');
});

test('a win after the throw is credited to the planting player, the trap\'s owner or not', () => {
  // O O O O at (0..3, 0); the cross is centred on (5, 1) and (4, 0) is the only free neighbour of the planted cell.
  const four = [0, 1, 2, 3].map((x) => [x, 0, O]);
  const state = wall(activeTornado(four, { x: 5, y: 1 }), 5, 1, [at(4, 0)]);
  const landed = placeResult(state, O, 5, 1, noRandomPick);
  assert.equal(landed.state.winner, O);
  assert.deepEqual(landed.state.winLine, [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 })));
  assert.deepEqual(types(landed.events), ['stonePlaced', 'tornadoStorm', 'stoneThrown', 'win']);
  assert.equal(landed.events.at(-1).player, O);
  assert.equal(landed.state.tornado, null);
  assert.equal(landed.state.board[1][5], EMPTY, 'the seed left the plot it was planted on');

  // The caster fires its own trap on its next turn and wins where the seed lands.
  const mine = [0, 1, 2, 3].map((x) => [x, 0, X]);
  const own = wall(activeTornado(mine, { x: 5, y: 1 }), 5, 1, [at(4, 0)]);
  const afterO = placeResult(own, O, 0, 14).state;
  const won = placeResult(afterO, X, 5, 1, noRandomPick);
  assert.equal(won.state.winner, X);
  assert.equal(won.events.at(-1).player, X);
});

// A random that returns anything: only one plot is free in these tests.
function noRandomPick() {
  return 0.5;
}

test('a seed blown out of a five does not win', () => {
  const broken = placeResult(activeTornado([2, 3, 4, 5].map((x) => [x, 7, O]), { x: 6, y: 7 }), O, 6, 7, () => 0);
  assert.equal(broken.state.board[7][6], EMPTY);
  assert.equal(broken.state.winner, null);
});

test('a seed that makes five where it was planted on a cross it does not fire wins normally (cast turn)', () => {
  const four = [2, 3, 4, 5].map((x) => [x, 7, X]);
  const result = placeStone(skillResult(stateWith(four), X, TORNADO_ZONE, { x: 6, y: 7 }).state, { player: X, x: 6, y: 7 }, { random: noRandom });
  assert.equal(result.state.winner, X, 'the cast turn does not arm the trap, so nothing throws the seed');
});

test('without an injected random the throw still lands on a free neighbour', () => {
  const result = placeResult(activeTornado(), O, 7, 7);
  const { to } = result.events[2];
  assert.ok(Math.abs(to.x - 7) <= 1 && Math.abs(to.y - 7) <= 1 && (to.x !== 7 || to.y !== 7));
  assert.equal(result.state.board[to.y][to.x], O);
  assert.deepEqual(JSON.parse(JSON.stringify(result.state)), result.state);
});

// --- TORNADO ZONE: expiry ---

test('an unfired trap ends after the caster\'s next turn and reveals nothing', () => {
  const afterO = placeResult(activeTornado(), O, 0, 0);
  assert.notEqual(afterO.state.tornado, null, 'still waiting after the opponent\'s turn');
  assert.equal(types(afterO.events).includes('tornadoEnded'), false);
  const afterX = placeResult(afterO.state, X, 0, 14);
  assert.equal(afterX.state.tornado, null);
  assert.deepEqual(afterX.events, [
    { type: 'stonePlaced', player: X, x: 0, y: 14 },
    { type: 'tornadoEnded', player: X },
    { type: 'turnEnded', player: X, turn: 3 },
  ]);
  assert.equal(JSON.stringify(afterX.events).includes('cells'), false, 'no cell of the cross is told');
  // Afterwards the old cross is plain soil.
  const later = placeStone(afterX.state, { player: O, x: 7, y: 7 }, { random: noRandom });
  assert.equal(later.state.board[7][7], O);
});

test('the trap is gone once the planting player wins on its own turn', () => {
  const four = [0, 1, 2, 3].map((x) => [x, 12, O]);
  const result = placeStone(activeTornado(four), { player: O, x: 4, y: 12 }, { random: noRandom });
  assert.equal(result.state.winner, O);
  assert.equal(result.state.tornado, null);
});
