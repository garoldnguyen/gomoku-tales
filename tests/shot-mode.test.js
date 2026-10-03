import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, SHOT_READY_FRAMES, SHOT_TIME_MS } from '../src/config.js';
import { EMPTY, O, ROCK, X, findWinLine } from '../src/logic/board.js';
import { createInitialState, isGameOver, placeStone, useSkill } from '../src/logic/game.js';
import { STONE_CONVERSION, TERRAIN_CREATION } from '../src/logic/skills.js';
import { createLocalGame } from '../src/ui/local-game.js';
import { parseShotParams, SHOT_SCENES, setUpShotScene } from '../src/ui/shot-mode.js';
import { SHOT_FIELD } from '../src/ui/shot-position.js';

const count = (board, kind) => board.flat().filter((cell) => cell === kind).length;

test('shot mode freezes time at 12.0 seconds (docs/shots.md section 4)', () => {
  assert.equal(SHOT_TIME_MS, 12000);
  assert.ok(Number.isInteger(SHOT_READY_FRAMES) && SHOT_READY_FRAMES >= 3);
});

test('the field position is legal: every action passes the rules and nobody has won', () => {
  let state = createInitialState();
  for (const { x, y, skill } of SHOT_FIELD.actions) {
    const player = state.currentPlayer;
    const result = skill
      ? useSkill(state, { player, skill, target: { x, y } })
      : placeStone(state, { player, x, y }, { random: () => 0 });
    assert.ok(result.ok, `${x},${y}: ${result.error}`);
    assert.ok(!result.events.some((e) => e.type === 'stoneThrown' || e.type === 'rockBroken'), 'no random throws, no broken rock');
    state = result.state;
  }
  assert.equal(isGameOver(state), false);
  assert.equal(findWinLine(state.board, X), null);
  assert.equal(findWinLine(state.board, O), null);
  const stones = count(state.board, X) + count(state.board, O);
  assert.ok(stones >= 12 && stones <= 16, `about 14 seeds, got ${stones}`);
  assert.equal(count(state.board, ROCK), 1);
  assert.equal(state.rocks.length, 1);
});

test('the field scene shows growing plants on its own seeds, the last move and a selected skill', () => {
  const game = createLocalGame({ random: () => 0 });
  const staged = setUpShotScene(game, 'field');
  const { board, currentPlayer } = game.getState();
  assert.equal(staged.growing.length, SHOT_FIELD.growing.length);
  for (const plant of staged.growing) {
    assert.ok(plant.player === X || plant.player === O, `a seed on ${plant.x},${plant.y}`);
    assert.ok(plant.ageMs > 0 && plant.ageMs < 1200, 'still growing at the shot time');
  }
  const last = SHOT_FIELD.actions.at(-1);
  assert.deepEqual(staged.last, { x: last.x, y: last.y, player: board[last.y][last.x], ageMs: SHOT_FIELD.lastMoveAgeMs });
  assert.equal(game.getTargeting().skill, SHOT_FIELD.selectedSkill);
  assert.equal(currentPlayer, O);
  assert.equal(SHOT_FIELD.selectedSkill, STONE_CONVERSION);
  assert.ok(SHOT_FIELD.actions.some((a) => a.skill === TERRAIN_CREATION), 'a rock is on the field');
  assert.equal(game.getView().message, null, 'no toast in the picture');
  assert.equal(game.takeEvents().length, 0, 'the scene events are not replayed');
  // Cell numbering is the game's own: the board is BOARD_SIZE square.
  assert.equal(board.length, BOARD_SIZE);
});

test('the empty scene is an empty board with X to move', () => {
  const game = createLocalGame();
  assert.deepEqual(setUpShotScene(game, 'empty'), { growing: [], last: null });
  const { board, currentPlayer } = game.getState();
  assert.ok(board.flat().every((cell) => cell === EMPTY));
  assert.equal(currentPlayer, X);
  assert.equal(game.getTargeting(), null);
});

test('parseShotParams: no shot parameter means normal play', () => {
  assert.equal(parseShotParams(''), null);
  assert.equal(parseShotParams('?quality=high'), null);
  assert.equal(parseShotParams('?local=1&render=2d'), null);
  assert.equal(parseShotParams(null), null);
});

test('parseShotParams reads the scene and the quality', () => {
  assert.deepEqual(SHOT_SCENES, ['field', 'empty']);
  assert.deepEqual(parseShotParams('?shot=field&quality=high'), { scene: 'field', quality: 'high', hud: null });
  assert.deepEqual(parseShotParams('?shot=empty&quality=low'), { scene: 'empty', quality: 'low', hud: null });
  assert.deepEqual(parseShotParams(new URLSearchParams('shot=EMPTY&quality=Medium')), { scene: 'empty', quality: 'medium', hud: null });
  assert.deepEqual(parseShotParams('?shot=field&quality=%20high%20'), { scene: 'field', quality: 'high', hud: null });
});

test('parseShotParams falls back to the field scene and medium quality', () => {
  assert.deepEqual(parseShotParams('?shot='), { scene: 'field', quality: 'medium', hud: null });
  assert.deepEqual(parseShotParams('?shot=castle&quality=ultra'), { scene: 'field', quality: 'medium', hud: null });
  assert.deepEqual(parseShotParams('?shot=field'), { scene: 'field', quality: 'medium', hud: null });
});
