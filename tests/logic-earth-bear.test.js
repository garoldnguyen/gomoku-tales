// Earth Bear: Mud Trap and Petrification (docs/free-action-design.md section 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, COOLDOWN_LONG, COOLDOWN_SHORT, MUD_LIFETIME_TURNS, MUD_SINK_TURNS } from '../src/config.js';
import { EMPTY, X, O, ROCK, SUNK } from '../src/logic/board.js';
import { MUD_TRAP, PETRIFICATION, WIND_DASH } from '../src/logic/skills.js';
import { createInitialState, isGameOver, placeStone, skillCooldown, useSkill } from '../src/logic/game.js';
import { skyWatchCells } from '../src/logic/cloud.js';
import { isSunk, scoringBoard } from '../src/logic/scoring-board.js';
import { skillTurn } from './skill-turn.js';

// Builds a playing state with cells set directly: [[x, y, value], ...].
function stateWith(cells, currentPlayer = O) {
  const state = createInitialState();
  for (const [x, y, value] of cells) state.board[y][x] = value;
  state.currentPlayer = currentPlayer;
  return state;
}

// A state with mud puddles on empty cells, made by O (Earth Bear) on turn 1.
function withMud(state, cells, driesAfterTurn = 1 + MUD_LIFETIME_TURNS) {
  state.mud = cells.map(([x, y]) => ({ x, y, player: O, driesAfterTurn }));
  return state;
}

function place(state, player, x, y) {
  const result = placeStone(state, { player, x, y });
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function placeResult(state, player, x, y) {
  const result = placeStone(state, { player, x, y });
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

const types = (events) => events.map((e) => e.type);

// X planted (0, 0) on turn 1: O is to move on turn 2.
const turnTwo = () => place(createInitialState(), X, 0, 0);

// --- MUD TRAP ---

test('Mud Trap makes a puddle on an empty cell, keeps the cell empty and does not end the turn', () => {
  const state = place(createInitialState(), X, 0, 0);
  const result = skillResult(state, O, MUD_TRAP, { x: 7, y: 7 });
  assert.equal(result.state.board[7][7], EMPTY, 'a puddle is no stone');
  assert.deepEqual(result.state.mud, [{ x: 7, y: 7, player: O, driesAfterTurn: 2 + MUD_LIFETIME_TURNS }]);
  assert.deepEqual(result.state.sunk, []);
  assert.equal(result.state.currentPlayer, O, 'O still has to plant');
  assert.equal(result.state.turn, 2);
  assert.equal(skillCooldown(result.state, O, MUD_TRAP), COOLDOWN_SHORT);
  assert.deepEqual(result.events, [
    { type: 'skillUsed', player: O, skill: MUD_TRAP, target: { x: 7, y: 7 } },
    { type: 'mudPlaced', player: O, x: 7, y: 7, driesAfterTurn: 2 + MUD_LIFETIME_TURNS },
  ]);
  assert.deepEqual(state.mud, [], 'the given state is not mutated');
  assert.deepEqual(JSON.parse(JSON.stringify(result.state)), result.state);
});

test('Mud Trap works on any empty cell, including corners', () => {
  for (const [x, y] of [[0, 0], [14, 0], [0, 14], [14, 14]]) {
    const result = skillResult(stateWith([]), O, MUD_TRAP, { x, y });
    assert.deepEqual(result.state.mud.map(({ x: mx, y: my }) => [mx, my]), [[x, y]]);
  }
});

test('Mud Trap rejects a cell that is not empty, already mud, or not on the board', () => {
  const state = withMud(stateWith([[3, 3, X], [4, 4, O], [5, 5, ROCK]]), [[6, 6]]);
  const action = (target) => ({ player: O, skill: MUD_TRAP, target });
  assertSkillRejected(state, action({ x: 3, y: 3 }), /not empty/);
  assertSkillRejected(state, action({ x: 4, y: 4 }), /not empty/);
  assertSkillRejected(state, action({ x: 5, y: 5 }), /not empty/);
  assertSkillRejected(state, action({ x: 6, y: 6 }), /already mud/);
  assertSkillRejected(state, action({ x: -1, y: 0 }), /on the board/);
  assertSkillRejected(state, action({ x: 0, y: BOARD_SIZE }), /on the board/);
  assertSkillRejected(state, action({ x: 1.5, y: 0 }), /on the board/);
  assertSkillRejected(state, action(null), /on the board/);
  assertSkillRejected(state, { player: O, skill: MUD_TRAP }, /on the board/);
});

test('a mud cell is empty: either player may plant on it, the caster too in the cast turn', () => {
  const state = skillResult(stateWith([]), O, MUD_TRAP, { x: 7, y: 7 }).state;
  assert.equal(placeStone(state, { player: O, x: 7, y: 7 }).ok, true, 'the caster plants on their own puddle');
  const next = place(place(stateWith([]), O, 0, 0), X, 7, 7);
  assert.equal(next.board[7][7], X, 'sanity: a plain cell');
  const other = place(skillTurn(stateWith([]), O, MUD_TRAP, { x: 7, y: 7 }, { x: 14, y: 14 }), X, 7, 7);
  assert.equal(other.board[7][7], X, 'the opponent plants on it');
});

// --- Sinking and surfacing ---

test('a seed planted on mud is sunk: it holds the cell, the puddle is used up and nothing dries', () => {
  const state = skillTurn(turnTwo(), O, MUD_TRAP, { x: 7, y: 7 }, { x: 14, y: 14 }); // turn 2 done
  assert.equal(state.turn, 3);
  const result = placeResult(state, X, 7, 7); // S = 3
  assert.equal(result.state.board[7][7], X);
  assert.deepEqual(result.state.mud, [], 'the puddle is used up');
  assert.deepEqual(result.state.sunk, [{ x: 7, y: 7, player: X, surfacesAfterTurn: 3 + MUD_SINK_TURNS }]);
  assert.deepEqual(types(result.events), ['stonePlaced', 'stoneSunk', 'turnEnded']);
  assert.deepEqual(result.events[1], { type: 'stoneSunk', player: X, x: 7, y: 7, surfacesAfterTurn: 3 + MUD_SINK_TURNS });
  assert.equal(isSunk(result.state, 7, 7), true);
});

test('the caster plants on their own puddle in the cast turn: a sunk seed of the caster', () => {
  const used = skillResult(turnTwo(), O, MUD_TRAP, { x: 7, y: 7 });
  const result = placeResult(used.state, O, 7, 7);
  assert.deepEqual(result.state.sunk, [{ x: 7, y: 7, player: O, surfacesAfterTurn: 2 + MUD_SINK_TURNS }]);
  assert.deepEqual(result.state.mud, []);
});

test('a sunk seed surfaces at the end of the turn S + MUD_SINK_TURNS, with the stoneSurfaced event', () => {
  let state = skillTurn(turnTwo(), O, MUD_TRAP, { x: 7, y: 7 }, { x: 14, y: 14 });
  state = place(state, X, 7, 7); // S = 3, O to move on turn 4
  assert.equal(state.sunk.length, 1);
  const result = placeResult(state, O, 14, 0); // the end of turn 4 = S + MUD_SINK_TURNS
  assert.deepEqual(result.state.sunk, []);
  assert.deepEqual(types(result.events), ['stonePlaced', 'stoneSurfaced', 'turnEnded']);
  assert.deepEqual(result.events[1], { type: 'stoneSurfaced', player: X, x: 7, y: 7 });
  assert.equal(result.state.board[7][7], X, 'the stone stays');
  assert.equal(result.state.winner, null);
});

test('a sunk seed makes no win now and wins at the end of the next turn, for its owner', () => {
  // X has four in row 0; the puddle is on the fifth cell.
  let state = withMud(stateWith([0, 1, 2, 3].map((x) => [x, 0, X]), X), [[4, 0]]);
  state.turn = 5;
  state.mud[0].driesAfterTurn = 5 + MUD_LIFETIME_TURNS;
  const planted = placeResult(state, X, 4, 0); // S = 5
  assert.equal(planted.state.winner, null, 'the sunk seed counts for no line');
  assert.equal(isGameOver(planted.state), false);
  assert.equal(planted.state.currentPlayer, O);
  const surfaced = placeResult(planted.state, O, 14, 14); // the end of turn 6
  assert.equal(surfaced.state.winner, X, 'X wins although O acted');
  assert.deepEqual(surfaced.state.winLine, [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 })));
  assert.deepEqual(types(surfaced.events), ['stonePlaced', 'stoneSurfaced', 'win']);
  assert.equal(surfaced.events.at(-1).player, X);
  assert.equal(isGameOver(surfaced.state), true);
  assert.equal(placeStone(surfaced.state, { player: O, x: 1, y: 14 }).ok, false);
});

test('the acting player\'s own planting is checked first: if both complete five in the same turn, the acting player wins', () => {
  let state = withMud(stateWith([...[0, 1, 2, 3].map((x) => [x, 0, X]), ...[0, 1, 2, 3].map((x) => [x, 2, O])], X), [[4, 0]]);
  const planted = placeResult(state, X, 4, 0); // X's fifth is sunk
  assert.equal(planted.state.winner, null);
  const result = placeResult(planted.state, O, 4, 2); // O makes five at once
  assert.equal(result.state.winner, O);
  assert.deepEqual(types(result.events), ['stonePlaced', 'win'], 'the seed of X never surfaces');
});

test('a sunk seed breaks the lines through it while it is sunk, and the scoring board shows SUNK', () => {
  // O O [X sunk] O O: five O only after the sunk cell is O... here X sinks between two O pairs.
  const state = withMud(stateWith([[0, 0, O], [1, 0, O], [3, 0, O], [4, 0, O]], X), [[2, 0]]);
  const planted = placeResult(state, X, 2, 0).state;
  const board = scoringBoard(planted);
  assert.equal(board[0][2], SUNK);
  assert.equal(planted.board[0][2], X, 'the true board keeps the stone');
  assert.equal(scoringBoard(createInitialState()).length, BOARD_SIZE);
});

test('scoringBoard returns the board itself when nothing is sunk and never changes the state', () => {
  const state = stateWith([[1, 1, X]]);
  assert.equal(scoringBoard(state), state.board);
  const sunk = { ...state, sunk: [{ x: 1, y: 1, player: X, surfacesAfterTurn: 9 }] };
  const before = JSON.stringify(sunk);
  const board = scoringBoard(sunk);
  assert.equal(board[1][1], SUNK);
  assert.notEqual(board, sunk.board);
  assert.equal(JSON.stringify(sunk), before);
});

test('Sky Watch reads the scoring board: a sunk seed counts for nobody', () => {
  // X has three in a row and a fourth, sunk, would make four: Sky Watch for O sees it only once it surfaced.
  const cells = [[5, 5, X], [6, 5, X], [7, 5, X], [8, 5, X]];
  const state = stateWith(cells);
  assert.ok(skyWatchCells(state, O).some((c) => c.x === 9 && c.y === 5));
  const sunk = { ...state, sunk: [{ x: 8, y: 5, player: X, surfacesAfterTurn: 9 }] };
  assert.equal(skyWatchCells(sunk, O).some((c) => c.x === 9 && c.y === 5), false, 'the sunk seed breaks the run');
  assert.equal(skyWatchCells(sunk, O).some((c) => c.x === 4 && c.y === 5), true, 'the three that count still make a four');
});

// --- Draw, deferred ---

function almostFull(emptyCells) {
  const state = createInitialState();
  // A checkerboard-ish fill with no five anywhere: rows alternate X, X, O, O.
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) state.board[y][x] = ((x >> 1) + y) % 2 === 0 ? X : O;
  }
  for (const [x, y] of emptyCells) state.board[y][x] = EMPTY;
  return state;
}

test('the last empty cell as mud: the draw waits for the sunk seed, which surfaces first', () => {
  const state = withMud(almostFull([[7, 7]]), [[7, 7]]);
  state.currentPlayer = X;
  const result = placeResult(state, X, 7, 7);
  assert.deepEqual(types(result.events), ['stonePlaced', 'stoneSunk', 'stoneSurfaced', 'draw'], 'the seed surfaces before the draw is decided');
  assert.equal(result.state.draw, true);
  assert.deepEqual(result.state.sunk, []);
});

test('the last empty cell as mud: a seed that makes five when it surfaces wins instead of a draw', () => {
  const state = withMud(almostFull([[7, 7]]), [[7, 7]]);
  // Five X in row 7 around the cell once it surfaces.
  for (const x of [5, 6, 8, 9]) state.board[7][x] = X;
  state.currentPlayer = X;
  const result = placeResult(state, X, 7, 7);
  assert.equal(result.state.winner, X);
  assert.equal(result.state.draw, false);
  assert.deepEqual(types(result.events), ['stonePlaced', 'stoneSunk', 'stoneSurfaced', 'win']);
});

test('a full board is no draw while a sunk seed is waiting: it surfaces at the end of its turn first', () => {
  // Two empty cells, one of them mud. X sinks a seed in the mud, O fills the last cell.
  const state = withMud(almostFull([[7, 7], [1, 14]]), [[7, 7]]);
  state.currentPlayer = X;
  const planted = placeResult(state, X, 7, 7);
  assert.equal(planted.state.draw, false);
  assert.equal(planted.state.sunk.length, 1);
  const filled = placeResult(planted.state, O, 1, 14);
  assert.deepEqual(types(filled.events), ['stonePlaced', 'stoneSurfaced', 'draw']);
  assert.equal(filled.state.draw, true);
});

test('Mud Trap on the last empty cell does not fill the board: no draw, the game goes on', () => {
  const state = almostFull([[7, 7]]);
  state.currentPlayer = O;
  const used = skillResult(state, O, MUD_TRAP, { x: 7, y: 7 });
  assert.equal(used.state.draw, false);
  assert.equal(used.state.currentPlayer, O);
});

// --- Puddles dry ---

test('a puddle dries at the end of the MUD_LIFETIME_TURNS-th turn after the cast turn', () => {
  let state = skillTurn(turnTwo(), O, MUD_TRAP, { x: 7, y: 7 }, { x: 0, y: 2 }); // cast on turn 2
  const dries = 2 + MUD_LIFETIME_TURNS;
  let dried = false;
  for (const [x, y] of [[1, 1], [2, 0], [3, 1], [4, 0], [5, 1], [6, 0]]) {
    const turn = state.turn;
    const result = placeResult(state, state.currentPlayer, x, y);
    const events = result.events.filter((e) => e.type === 'mudDried');
    if (turn < dries) {
      assert.deepEqual(events, [], `turn ${turn}: still wet`);
      assert.equal(result.state.mud.length, 1);
      state = result.state;
      continue;
    }
    assert.equal(turn, dries);
    assert.deepEqual(events, [{ type: 'mudDried', player: O, x: 7, y: 7 }]);
    assert.deepEqual(result.state.mud, []);
    assert.equal(result.state.board[7][7], EMPTY, 'the cell is plain soil again');
    dried = true;
    break;
  }
  assert.equal(dried, true);
});

test('a planted puddle never dries: it is used up, so no mudDried', () => {
  let state = skillTurn(turnTwo(), O, MUD_TRAP, { x: 7, y: 7 }, { x: 0, y: 2 });
  state = place(state, X, 7, 7);
  const events = [];
  for (const [x, y] of [[1, 1], [2, 0], [3, 1], [4, 0], [5, 1]]) {
    const result = placeResult(state, state.currentPlayer, x, y);
    events.push(...result.events);
    state = result.state;
  }
  assert.equal(events.some((e) => e.type === 'mudDried'), false);
});

// --- Wind Dash and mud / sunk ---

test('a Wind Dash cannot start from a sunk seed, and cannot land on mud', () => {
  const state = withMud(stateWith([[3, 3, X]], X), [[5, 5]]);
  state.sunk = [{ x: 3, y: 3, player: X, surfacesAfterTurn: 9 }];
  assertSkillRejected(state, { player: X, skill: WIND_DASH, target: { from: { x: 3, y: 3 }, to: { x: 4, y: 4 } } }, /sunk in mud/);
  const clear = withMud(stateWith([[3, 3, X]], X), [[5, 5]]);
  assertSkillRejected(clear, { player: X, skill: WIND_DASH, target: { from: { x: 3, y: 3 }, to: { x: 5, y: 5 } } }, /mud/);
  assert.equal(useSkill(clear, { player: X, skill: WIND_DASH, target: { from: { x: 3, y: 3 }, to: { x: 4, y: 4 } } }).ok, true);
});

test('a pending Wind Dash fails with targetTaken when its target became mud', () => {
  let state = stateWith([[3, 3, X]], X);
  state = skillTurn(state, X, WIND_DASH, { from: { x: 3, y: 3 }, to: { x: 4, y: 4 } }, { x: 14, y: 14 });
  state = withMud(state, [[4, 4]]);
  const result = placeResult(state, O, 0, 14);
  const failed = result.events.find((e) => e.type === 'dashFailed');
  assert.equal(failed.reason, 'targetTaken');
  assert.equal(result.state.board[3][3], X);
  assert.equal(result.state.board[4][4], EMPTY);
});

// --- PETRIFICATION ---

test('Petrification turns an opponent plant into a permanent rock at once and does not end the turn', () => {
  const state = stateWith([[6, 6, X], [7, 7, X]]);
  const result = skillResult(state, O, PETRIFICATION, { x: 6, y: 6 });
  assert.equal(result.state.board[6][6], ROCK);
  assert.equal(result.state.board[7][7], X, 'only the chosen plant changes');
  assert.deepEqual(result.state.rocks, [{ x: 6, y: 6 }], 'a rock has no breaksAfterTurn');
  assert.equal(result.state.currentPlayer, O, 'O still has to plant');
  assert.equal(skillCooldown(result.state, O, PETRIFICATION), COOLDOWN_LONG);
  assert.deepEqual(result.events, [
    { type: 'skillUsed', player: O, skill: PETRIFICATION, target: { x: 6, y: 6 } },
    { type: 'stonePetrified', player: O, x: 6, y: 6, from: X },
  ]);
  assert.equal(state.board[6][6], X, 'the given state is not mutated');
  assert.deepEqual(state.rocks, []);
});

test('Petrification refuses an empty cell, a rock, an own plant, a sunk seed and a cell off the board', () => {
  const state = stateWith([[3, 3, X], [4, 4, O], [5, 5, ROCK], [8, 8, X]]);
  state.rocks = [{ x: 5, y: 5 }];
  state.sunk = [{ x: 8, y: 8, player: X, surfacesAfterTurn: 9 }];
  const action = (target) => ({ player: O, skill: PETRIFICATION, target });
  assertSkillRejected(state, action({ x: 4, y: 4 }), /opponent's stones/);
  assertSkillRejected(state, action({ x: 5, y: 5 }), /opponent's stones/);
  assertSkillRejected(state, action({ x: 0, y: 0 }), /opponent's stones/);
  assertSkillRejected(state, action({ x: 8, y: 8 }), /That plant is sunk in mud\./);
  assertSkillRejected(state, action({ x: BOARD_SIZE, y: 0 }), /on the board/);
  assertSkillRejected(state, action({ x: -1, y: 0 }), /on the board/);
  assertSkillRejected(state, action(null), /on the board/);
  assert.equal(useSkill(state, action({ x: 3, y: 3 })).ok, true);
});

test('a refused Petrification does not use the turn: the skill stays ready', () => {
  const state = stateWith([[4, 4, O]]);
  assert.equal(useSkill(state, { player: O, skill: PETRIFICATION, target: { x: 4, y: 4 } }).ok, false);
  assert.equal(skillCooldown(state, O, PETRIFICATION), 0);
  assert.equal(state.skillUsed, null);
});

test('a petrified plant is a rock for good: nobody plants on it and it never breaks', () => {
  let state = place(createInitialState(), X, 7, 7);
  state = skillTurn(state, O, PETRIFICATION, { x: 7, y: 7 }, { x: 0, y: 0 });
  assert.equal(placeStone(state, { player: X, x: 7, y: 7 }).ok, false);
  const spots = [[1, 0], [2, 1], [3, 0], [4, 1], [5, 0], [6, 1], [8, 0], [9, 1], [10, 0], [11, 1], [12, 0], [13, 1]];
  for (const [x, y] of spots) {
    const result = placeResult(state, state.currentPlayer, x, y);
    assert.equal(result.events.some((e) => /rock/i.test(e.type)), false);
    state = result.state;
    assert.equal(state.board[7][7], ROCK);
  }
  assert.deepEqual(state.rocks, [{ x: 7, y: 7 }]);
  assertSkillRejected({ ...state, currentPlayer: O, cooldowns: { ...state.cooldowns, O: { ...state.cooldowns.O, [PETRIFICATION]: 0 } } },
    { player: O, skill: PETRIFICATION, target: { x: 7, y: 7 } }, /opponent's stones/);
});

test('a petrified plant breaks the opponent\'s line', () => {
  // X X X X _ : O turns the second X into a rock, so X cannot finish five there.
  const cells = [0, 1, 2, 3].map((x) => [x, 0, X]);
  let state = skillTurn(stateWith(cells), O, PETRIFICATION, { x: 1, y: 0 }, { x: 14, y: 14 });
  state = place(state, X, 4, 0);
  assert.equal(state.winner, null);
});

test('a sunk seed can be petrified once it has surfaced', () => {
  let state = withMud(stateWith([], X), [[7, 7]]);
  state = place(state, X, 7, 7); // sunk; O to move
  assertSkillRejected({ ...state, currentPlayer: O }, { player: O, skill: PETRIFICATION, target: { x: 7, y: 7 } }, /sunk in mud/);
  state = place(state, O, 0, 0); // the seed surfaces at the end of this turn
  assert.deepEqual(state.sunk, []);
  const petrified = skillResult({ ...state, currentPlayer: O }, O, PETRIFICATION, { x: 7, y: 7 });
  assert.equal(petrified.state.board[7][7], ROCK);
});

test('a pending Wind Dash fails with sourceLost when its source plant was petrified', () => {
  let state = place(createInitialState(), X, 3, 3);
  state.board[3][3] = X;
  // X dashes (3, 3) to (4, 4) on its next turn: here set up directly, X to move.
  state = skillTurn({ ...state, currentPlayer: X, turn: 3 }, X, WIND_DASH, { from: { x: 3, y: 3 }, to: { x: 4, y: 4 } }, { x: 14, y: 14 });
  assert.ok(state.pendingDash);
  state = skillTurn(state, O, PETRIFICATION, { x: 3, y: 3 }, { x: 0, y: 14 });
  assert.equal(state.pendingDash, null, 'the dash resolved at the end of the opponent turn');
  assert.equal(state.board[3][3], ROCK);
  assert.equal(state.board[4][4], EMPTY);
});
