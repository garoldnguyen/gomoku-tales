import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, CELL_PX } from '../src/config.js';
import { X, O } from '../src/logic/board.js';
import { BOARD_PX, BOARD_X, BOARD_Y, cellAtPoint, cellCenter } from '../src/render/layout.js';
import { isRestartKey, toInternalPoint } from '../src/ui/input.js';
import { createLocalGame, statusText } from '../src/ui/local-game.js';

// --- Layout ---

test('board is 15x15 cells of 24 px, centred on the 960x540 screen', () => {
  assert.equal(BOARD_PX, BOARD_SIZE * CELL_PX);
  assert.equal(BOARD_X, (960 - BOARD_PX) / 2);
  assert.equal(BOARD_Y, (540 - BOARD_PX) / 2);
});

test('cellAtPoint maps pixels to cells, including the edges', () => {
  assert.deepEqual(cellAtPoint(BOARD_X, BOARD_Y), { x: 0, y: 0 });
  assert.deepEqual(cellAtPoint(BOARD_X + CELL_PX - 0.1, BOARD_Y + CELL_PX - 0.1), { x: 0, y: 0 });
  assert.deepEqual(cellAtPoint(BOARD_X + CELL_PX, BOARD_Y), { x: 1, y: 0 });
  assert.deepEqual(cellAtPoint(BOARD_X + BOARD_PX - 1, BOARD_Y + BOARD_PX - 1), { x: 14, y: 14 });
});

test('cellAtPoint returns null off the board', () => {
  assert.equal(cellAtPoint(BOARD_X - 1, BOARD_Y + 10), null);
  assert.equal(cellAtPoint(BOARD_X + 10, BOARD_Y - 1), null);
  assert.equal(cellAtPoint(BOARD_X + BOARD_PX, BOARD_Y + 10), null);
  assert.equal(cellAtPoint(BOARD_X + 10, BOARD_Y + BOARD_PX), null);
});

test('cellCenter round-trips through cellAtPoint', () => {
  for (const [x, y] of [[0, 0], [7, 7], [14, 0], [3, 14]]) {
    const { px, py } = cellCenter(x, y);
    assert.deepEqual(cellAtPoint(px, py), { x, y });
  }
});

// --- Input ---

test('toInternalPoint scales window coordinates to the internal canvas size', () => {
  const rect = { left: 100, top: 50, width: 1920, height: 1080 };
  assert.deepEqual(toInternalPoint(rect, 960, 540, 100, 50), { px: 0, py: 0 });
  assert.deepEqual(toInternalPoint(rect, 960, 540, 1060, 590), { px: 480, py: 270 });
});

test('R restarts but Ctrl/Cmd+R is left to the browser', () => {
  assert.equal(isRestartKey({ key: 'r' }), true);
  assert.equal(isRestartKey({ key: 'R' }), true);
  assert.equal(isRestartKey({ key: 'r', ctrlKey: true }), false);
  assert.equal(isRestartKey({ key: 'r', metaKey: true }), false);
  assert.equal(isRestartKey({ key: 'x' }), false);
});

// --- Local mode controller ---

test('local mode: one window plays both sides, alternating X then O', () => {
  const game = createLocalGame();
  assert.equal(game.click({ x: 7, y: 7 }), true);
  assert.equal(game.click({ x: 8, y: 7 }), true);
  const { board, currentPlayer } = game.getState();
  assert.equal(board[7][7], X);
  assert.equal(board[7][8], O);
  assert.equal(currentPlayer, X);
});

test('local mode: clicking an occupied cell is rejected with a message', () => {
  const game = createLocalGame();
  game.click({ x: 7, y: 7 });
  const before = game.getState();
  assert.equal(game.click({ x: 7, y: 7 }), false);
  assert.equal(game.getState(), before);
  assert.equal(game.getView().message, 'That cell is not empty.');
  game.click({ x: 0, y: 0 });
  assert.equal(game.getView().message, null);
});

test('local mode: clicking off the board does nothing', () => {
  const game = createLocalGame();
  const before = game.getState();
  assert.equal(game.click(null), false);
  assert.equal(game.getState(), before);
  assert.equal(game.getView().message, null);
});

test('local mode: hover shows only on empty cells while the game is running', () => {
  const game = createLocalGame();
  game.setHover({ x: 3, y: 3 });
  assert.deepEqual(game.getView().hover, { x: 3, y: 3 });
  game.click({ x: 3, y: 3 });
  assert.equal(game.getView().hover, null);
  game.setHover(null);
  assert.equal(game.getView().hover, null);
});

function playXWin(game) {
  for (let i = 0; i < 4; i++) {
    game.click({ x: i, y: 0 }); // X
    game.click({ x: i, y: 1 }); // O
  }
  game.click({ x: 4, y: 0 }); // X makes five
}

test('local mode: status shows whose turn it is and the winner', () => {
  const game = createLocalGame();
  assert.equal(game.getView().status, 'Blue X to move');
  game.click({ x: 7, y: 7 });
  assert.equal(game.getView().status, 'Red O to move');

  const won = createLocalGame();
  playXWin(won);
  assert.equal(won.getState().winner, X);
  assert.equal(won.getView().status, 'Blue X wins! Press R to restart.');
  assert.equal(won.getState().winLine.length, 5);
});

test('local mode: no hover or placement after the game is won', () => {
  const game = createLocalGame();
  playXWin(game);
  game.setHover({ x: 10, y: 10 });
  assert.equal(game.getView().hover, null);
  assert.equal(game.click({ x: 10, y: 10 }), false);
  assert.equal(game.getState().board[10][10], null);
});

test('local mode: restart gives a fresh board with X to move', () => {
  const game = createLocalGame();
  playXWin(game);
  game.click({ x: 10, y: 10 });
  game.restart();
  const state = game.getState();
  assert.equal(state.winner, null);
  assert.equal(state.currentPlayer, X);
  assert.ok(state.board.every((row) => row.every((cell) => cell === null)));
  assert.equal(game.getView().message, null);
});

test('statusText reports a draw', () => {
  const state = { board: [], currentPlayer: X, winner: null, winLine: null, draw: true };
  assert.equal(statusText(state), 'Draw! Press R to restart.');
});
