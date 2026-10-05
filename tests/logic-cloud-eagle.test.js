// Cloud Eagle part 1: the rules of Sky Watch and Cloud (docs/design.md
// section 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, CLOUD_SIZE, CLOUD_TURNS, COOLDOWN_LONG } from '../src/config.js';
import { EMPTY, ROCK, X, O } from '../src/logic/board.js';
import { ALL_CHARACTERS, CHARACTERS, CLOUD_EAGLE, EARTH_BEAR, assignSides } from '../src/logic/characters.js';
import { canUseSkill, newGame, placeStone, skillCooldown, useSkill } from '../src/logic/game.js';
import { CLOUD, LONG, PASSIVE, SKILLS, SKY_WATCH, cooldownTurns, getSkill, isPassiveSkill } from '../src/logic/skills.js';
import { cloudCells, cloudsOf, createCloud, inCloud, skyWatchCells, tickClouds } from '../src/logic/cloud.js';

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function place(state, player, x, y) {
  return ok(placeStone(state, { player, x, y }));
}

function useCloud(state, player, x, y) {
  return ok(useSkill(state, { player, skill: CLOUD, target: { x, y } }));
}

// Cloud Eagle picked first (X) against Earth Bear (O).
function eagleGame() {
  return newGame({ characters: assignSides([CLOUD_EAGLE, EARTH_BEAR]) });
}

test('the config numbers of the cloud', () => {
  assert.equal(CLOUD_SIZE, 5);
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

test('a cloud on an empty cell: no stone, the turn is used, the record holds centre, owner and turns left', () => {
  const before = eagleGame();
  const result = useSkill(before, { player: X, skill: CLOUD, target: { x: 7, y: 7 } });
  const state = ok(result);
  assert.deepEqual(state.board, before.board, 'no stone is placed');
  assert.equal(state.currentPlayer, O);
  assert.equal(state.turn, 2);
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

  const rocks = [{ x: 10, y: 10, breaksAfterTurn: 99 }];
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
  const { board } = eagleGame();
  const half = Math.floor(CLOUD_SIZE / 2);
  const centre = createCloud(7, 7, X, 1);
  assert.equal(cloudCells(board, centre).length, CLOUD_SIZE * CLOUD_SIZE);
  assert.equal(inCloud(centre, 7 + half, 7 - half), true);
  assert.equal(inCloud(centre, 7 + half + 1, 7), false);

  const corner = createCloud(0, 0, X, 1);
  const cells = cloudCells(board, corner);
  assert.equal(cells.length, (half + 1) * (half + 1));
  assert.ok(cells.every(({ x, y }) => x >= 0 && y >= 0 && x <= half && y <= half));

  const edge = createCloud(BOARD_SIZE - 1, 7, X, 1);
  const edgeCells = cloudCells(board, edge);
  assert.equal(edgeCells.length, (half + 1) * CLOUD_SIZE);
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

test('skyWatchCells returns nothing when there is no threat, and clouds hide nothing from it', () => {
  let state = eagleGame();
  assert.deepEqual(skyWatchCells(state, X), []);
  const board = state.board.map((row) => row.slice());
  for (const x of [3, 4, 5]) board[5][x] = O; // three only
  assert.deepEqual(skyWatchCells({ ...state, board }, X), []);
  for (const y of [10, 11, 12, 13]) board[y][14] = O; // four down the edge column
  state = { ...state, board, clouds: [createCloud(14, 12, O, 1)] };
  assert.deepEqual(skyWatchCells(state, X), [{ x: 14, y: 9 }, { x: 14, y: 14 }]);
  assert.equal(state.board[9][14], EMPTY);
});
