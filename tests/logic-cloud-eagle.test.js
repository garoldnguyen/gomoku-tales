// Cloud Eagle part 1: the rules of Sky Watch and Cloud (docs/design.md
// section 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, CLOUD_SIZE, CLOUD_TURNS, COOLDOWN_LONG, SKY_WATCH_RUN } from '../src/config.js';
import { EMPTY, ROCK, X, O } from '../src/logic/board.js';
import { ALL_CHARACTERS, CHARACTERS, CLOUD_EAGLE, EARTH_BEAR, assignSides } from '../src/logic/characters.js';
import { canUseSkill, newGame, placeStone, skillCooldown, useSkill } from '../src/logic/game.js';
import { CLOUD, LONG, PASSIVE, SKILLS, SKY_WATCH, cooldownTurns, getSkill, isPassiveSkill } from '../src/logic/skills.js';
import { cloudCells, cloudReach, cloudsOf, createCloud, inCloud, skyWatchCells, tickClouds } from '../src/logic/cloud.js';
import { skillTurn } from './skill-turn.js';

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function place(state, player, x, y) {
  return ok(placeStone(state, { player, x, y }));
}

// The cloud is placed and the owner plants a seed (a spare cell, or cell) to
// end the turn: a skill does not end it any more.
function useCloud(state, player, x, y, cell = null) {
  return skillTurn(state, player, CLOUD, { x, y }, cell);
}

// Cloud Eagle picked first (X) against Earth Bear (O).
function eagleGame() {
  return newGame({ characters: assignSides([CLOUD_EAGLE, EARTH_BEAR]) });
}

test('the config numbers of the cloud', () => {
  assert.equal(CLOUD_SIZE, 4); // Free Action part 5: the 4 by 4 cloud (was 5)
  assert.equal(CLOUD_TURNS, 2);
});

test('Cloud Eagle owns Sky Watch (passive, no cooldown) and Cloud (cooldown COOLDOWN_LONG, 6)', () => {
  assert.deepEqual(ALL_CHARACTERS[CLOUD_EAGLE], { id: CLOUD_EAGLE, name: 'Cloud Eagle', skills: [SKY_WATCH, CLOUD] });
  assert.equal(getSkill(SKY_WATCH).cooldownClass, PASSIVE);
  assert.equal(getSkill(CLOUD).cooldownClass, LONG);
  assert.equal(isPassiveSkill(SKY_WATCH), true);
  assert.equal(isPassiveSkill(CLOUD), false);
  assert.equal(cooldownTurns(SKY_WATCH), 0);
  assert.equal(cooldownTurns(CLOUD), COOLDOWN_LONG);
  assert.equal(cooldownTurns(CLOUD), 6);
  // Since part 3 the screens' tables list Cloud Eagle too.
  assert.equal(Object.hasOwn(CHARACTERS, CLOUD_EAGLE), true);
  assert.equal(Object.hasOwn(SKILLS, CLOUD), true);
  assert.equal(Object.hasOwn(SKILLS, SKY_WATCH), true);
});

test('Sky Watch is always on: it cannot be used and never has a cooldown', () => {
  let state = eagleGame();
  assert.equal(skillCooldown(state, X, SKY_WATCH), 0);
  assert.equal(canUseSkill(state, X, SKY_WATCH), false);
  const result = useSkill(state, { player: X, skill: SKY_WATCH });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Sky Watch is always on.');
  state = useCloud(state, X, 7, 7);
  assert.equal(skillCooldown(state, X, SKY_WATCH), 0);
  assert.equal(skillCooldown(state, X, CLOUD), COOLDOWN_LONG);
});

test('a cloud on an empty cell: no stone, the turn goes on, the record holds centre, owner and turns left', () => {
  const before = eagleGame();
  const result = useSkill(before, { player: X, skill: CLOUD, target: { x: 7, y: 7 } });
  const state = ok(result);
  assert.deepEqual(state.board, before.board, 'no stone is placed');
  assert.equal(state.currentPlayer, X, 'the owner still has to plant');
  assert.equal(state.turn, 1);
  assert.equal(place(state, X, 0, 0).currentPlayer, O);
  assert.deepEqual(cloudsOf(state), [{ x: 7, y: 7, owner: X, turnsLeft: CLOUD_TURNS, placedTurn: 1 }]);
  const placed = result.events.find((e) => e.type === 'cloudPlaced');
  assert.equal(placed.cells.length, CLOUD_SIZE * CLOUD_SIZE);
  assert.deepEqual(before.clouds, undefined, 'the old state is untouched');
});

test('a cloud on a cell that holds a stone, and on a rock cell; the rock is not affected', () => {
  let state = eagleGame();
  state = place(state, X, 3, 3);
  state = place(state, O, 4, 4);
  const stoneCloud = useCloud(state, X, 4, 4);
  assert.equal(stoneCloud.board[4][4], O, 'the stone under the cloud stays');
  assert.equal(stoneCloud.board[3][3], X);
  assert.deepEqual(cloudsOf(stoneCloud)[0], { x: 4, y: 4, owner: X, turnsLeft: CLOUD_TURNS, placedTurn: 3 });

  const rocks = [{ x: 10, y: 10 }];
  const board = state.board.map((row) => row.slice());
  board[10][10] = ROCK;
  const rocky = { ...state, board, rocks };
  const rockCloud = useCloud(rocky, X, 10, 10);
  assert.equal(rockCloud.board[10][10], ROCK);
  assert.deepEqual(rockCloud.rocks, rocks);
  assert.equal(cloudsOf(rockCloud)[0].x, 10);
});

test('a cloud off the board is refused', () => {
  const result = useSkill(eagleGame(), { player: X, skill: CLOUD, target: { x: BOARD_SIZE, y: 0 } });
  assert.equal(result.ok, false);
});

test('the cloud covers CLOUD_SIZE by CLOUD_SIZE cells and is clipped at the board edge', () => {
  // Free Action part 5: the 4 by 4 cloud has no centre cell; it covers x - lo to x + hi (lo 1, hi 2).
  const { board } = eagleGame();
  const { lo, hi } = cloudReach();
  assert.deepEqual([lo, hi], [1, 2]);
  const centre = createCloud(7, 7, X, 1);
  assert.equal(cloudCells(board, centre).length, CLOUD_SIZE * CLOUD_SIZE);
  assert.equal(inCloud(centre, 7 + hi, 7 - lo), true);
  assert.equal(inCloud(centre, 7 + hi + 1, 7), false);
  assert.equal(inCloud(centre, 7 - lo - 1, 7), false);

  const corner = createCloud(0, 0, X, 1);
  const cells = cloudCells(board, corner);
  assert.equal(cells.length, (hi + 1) * (hi + 1), 'the corner cloud keeps x 0 to 2 and y 0 to 2');
  assert.ok(cells.every(({ x, y }) => x >= 0 && y >= 0 && x <= hi && y <= hi));

  const edge = createCloud(BOARD_SIZE - 1, 7, X, 1);
  const edgeCells = cloudCells(board, edge);
  assert.equal(edgeCells.length, (lo + 1) * CLOUD_SIZE, 'the right edge cloud keeps x 13 and 14 only');
  assert.ok(edgeCells.every(({ x }) => x < BOARD_SIZE));
});

test('the cloud lasts the owner two turns and then disappears; stones placed inside stay', () => {
  let state = useCloud(eagleGame(), X, 7, 7); // turn 1: the cloud is placed
  state = place(state, O, 7, 7); // the opponent's turn does not count
  assert.equal(cloudsOf(state)[0].turnsLeft, CLOUD_TURNS);
  state = place(state, X, 6, 6); // the owner's first turn
  assert.equal(cloudsOf(state)[0].turnsLeft, CLOUD_TURNS - 1);
  state = place(state, O, 8, 8);
  assert.equal(cloudsOf(state).length, 1);
  const result = placeStone(state, { player: X, x: 6, y: 7 }); // the owner's second turn
  state = ok(result);
  assert.deepEqual(cloudsOf(state), []);
  assert.deepEqual(result.events.filter((e) => e.type === 'cloudEnded'), [{ type: 'cloudEnded', player: X, x: 7, y: 7 }]);
  assert.equal(state.board[7][7], O);
  assert.equal(state.board[6][6], X);
  assert.equal(state.board[8][8], O);
  assert.equal(state.board[7][6], X);
});

test('tickClouds only counts down the clouds of the player placed before this turn', () => {
  const mine = createCloud(2, 2, X, 1);
  const theirs = createCloud(9, 9, O, 2);
  const fresh = createCloud(5, 5, X, 3);
  const clouds = [mine, theirs, fresh];
  const { clouds: next, events } = tickClouds(clouds, X, 3);
  assert.deepEqual(next, [{ ...mine, turnsLeft: CLOUD_TURNS - 1 }, theirs, fresh]);
  assert.deepEqual(events, []);
  assert.equal(tickClouds(clouds, O, 2).clouds, clouds, 'nothing to count: the same array');
});

test('a game without clouds keeps no clouds field', () => {
  let state = eagleGame();
  state = place(state, X, 0, 0);
  state = place(state, O, 1, 1);
  assert.equal(Object.hasOwn(state, 'clouds'), false);
});

test('skyWatchCells finds the cells where the opponent makes five with one move', () => {
  let state = eagleGame();
  // O (the opponent of the Eagle) has four in a row on row 5, open at both ends.
  const board = state.board.map((row) => row.slice());
  for (const x of [3, 4, 5, 6]) board[5][x] = O;
  board[9][0] = O; // a lone stone makes no threat
  state = { ...state, board };
  assert.deepEqual(skyWatchCells(state, X), [{ x: 2, y: 5 }, { x: 7, y: 5 }]);
  // A blocked end (a stone or a rock) leaves only the other end.
  board[5][7] = ROCK;
  assert.deepEqual(skyWatchCells({ ...state, board }, X), [{ x: 2, y: 5 }]);
  // A gap in the line is a threat too, by the same win rule.
  const gap = eagleGame().board.map((row) => row.slice());
  for (const x of [3, 4, 6, 7]) gap[2][x] = O;
  assert.deepEqual(skyWatchCells({ ...state, board: gap }, X), [{ x: 5, y: 2 }]);
  // The opponent's view: X has no threat.
  assert.deepEqual(skyWatchCells(state, O), []);
});

test('skyWatchCells marks where the opponent would make four (SKY_WATCH_RUN) or more, and clouds hide nothing from it', () => {
  let state = eagleGame();
  assert.equal(SKY_WATCH_RUN, 4);
  assert.deepEqual(skyWatchCells(state, X), []);
  const board = state.board.map((row) => row.slice());
  for (const x of [3, 4]) board[5][x] = O; // two only: nothing yet
  assert.deepEqual(skyWatchCells({ ...state, board }, X), []);
  board[5][5] = O; // three: both ends would make four
  assert.deepEqual(skyWatchCells({ ...state, board }, X), [{ x: 2, y: 5 }, { x: 6, y: 5 }]);
  board[5][6] = ROCK; // a rock breaks the line on that side
  assert.deepEqual(skyWatchCells({ ...state, board }, X), [{ x: 2, y: 5 }]);
  const split = state.board.map((row) => row.slice());
  for (const x of [3, 4, 6]) split[9][x] = O; // a broken three: the gap makes four
  assert.deepEqual(skyWatchCells({ ...state, board: split }, X), [{ x: 5, y: 9 }]);
  for (const y of [10, 11, 12, 13]) split[y][14] = O; // four down the edge column
  state = { ...state, board: split, clouds: [createCloud(14, 12, O, 1)] };
  const cells = skyWatchCells(state, X);
  assert.ok(cells.some((c) => c.x === 14 && c.y === 9) && cells.some((c) => c.x === 14 && c.y === 14), 'a four still shows, under a cloud too');
  assert.equal(state.board[9][14], EMPTY);
});