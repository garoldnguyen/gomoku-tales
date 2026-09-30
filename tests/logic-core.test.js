import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE } from '../src/config.js';
import { EMPTY, X, O, ROCK, findWinLine, findWinLineAt, isBoardFull, isEmptyCell } from '../src/logic/board.js';
import { createInitialState, isGameOver, placeStone } from '../src/logic/game.js';

// Builds a playing state with cells set directly: [[x, y, value], ...].
function stateWith(cells, currentPlayer = X) {
  const state = createInitialState();
  for (const [x, y, value] of cells) state.board[y][x] = value;
  state.currentPlayer = currentPlayer;
  return state;
}

// Cells of a line of `length` stones starting at (x, y) going (dx, dy).
function line(x, y, dx, dy, length, value) {
  return Array.from({ length }, (_, i) => [x + i * dx, y + i * dy, value]);
}

function place(state, player, x, y) {
  const result = placeStone(state, { player, x, y });
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function assertRejected(state, action) {
  const before = JSON.stringify(state);
  const result = placeStone(state, action);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.equal(JSON.stringify(state), before, 'state must not change');
}

// --- Initial state ---

test('initial state is an empty 15x15 board with X to move', () => {
  const state = createInitialState();
  assert.equal(state.board.length, BOARD_SIZE);
  for (const row of state.board) {
    assert.equal(row.length, BOARD_SIZE);
    assert.ok(row.every((cell) => cell === EMPTY));
  }
  assert.equal(state.currentPlayer, X);
  assert.equal(state.winner, null);
  assert.equal(state.winLine, null);
  assert.equal(state.draw, false);
  assert.equal(isGameOver(state), false);
});

test('initial state is plain serializable data', () => {
  const state = createInitialState();
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

// --- Placement and turn switching ---

test('placing a stone puts it on the board and switches the turn', () => {
  let state = createInitialState();
  state = place(state, X, 7, 7);
  assert.equal(state.board[7][7], X);
  assert.equal(state.currentPlayer, O);
  state = place(state, O, 8, 7);
  assert.equal(state.board[7][8], O);
  assert.equal(state.currentPlayer, X);
});

test('placeStone does not mutate the given state', () => {
  const state = createInitialState();
  const before = JSON.stringify(state);
  const next = place(state, X, 0, 0);
  assert.equal(JSON.stringify(state), before);
  assert.notEqual(next.board, state.board);
});

// --- Invalid moves ---

test('rejects a move by the wrong player', () => {
  assertRejected(createInitialState(), { player: O, x: 7, y: 7 });
  const state = place(createInitialState(), X, 7, 7);
  assertRejected(state, { player: X, x: 8, y: 8 });
});

test('rejects a move onto a cell holding a stone', () => {
  let state = place(createInitialState(), X, 7, 7);
  assertRejected(state, { player: O, x: 7, y: 7 });
  state = place(state, O, 3, 3);
  assertRejected(state, { player: X, x: 3, y: 3 });
});

test('rejects a move onto a cell holding a rock', () => {
  const state = stateWith([[4, 4, ROCK]]);
  assert.equal(isEmptyCell(state.board, 4, 4), false);
  assertRejected(state, { player: X, x: 4, y: 4 });
});

test('rejects moves off the board or with bad coordinates', () => {
  const state = createInitialState();
  assertRejected(state, { player: X, x: -1, y: 0 });
  assertRejected(state, { player: X, x: 0, y: -1 });
  assertRejected(state, { player: X, x: BOARD_SIZE, y: 0 });
  assertRejected(state, { player: X, x: 0, y: BOARD_SIZE });
  assertRejected(state, { player: X, x: 1.5, y: 2 });
  assertRejected(state, { player: X, x: '3', y: 3 });
  assertRejected(state, { player: X });
});

test('rejects an unknown player', () => {
  assertRejected(createInitialState(), { player: ROCK, x: 0, y: 0 });
  assertRejected(createInitialState(), { player: 'Z', x: 0, y: 0 });
});

test('rejects any move after the game is won', () => {
  let state = stateWith(line(0, 0, 1, 0, 4, X));
  state = place(state, X, 4, 0);
  assert.equal(state.winner, X);
  assertRejected(state, { player: O, x: 10, y: 10 });
  assertRejected(state, { player: X, x: 10, y: 10 });
});

test('rejects any move after a draw', () => {
  const state = { ...createInitialState(), draw: true };
  assert.equal(isGameOver(state), true);
  assertRejected(state, { player: X, x: 0, y: 0 });
});

// --- Win detection ---

test('five in a row wins in all four directions', () => {
  const cases = [
    { name: 'horizontal', start: [3, 5], dir: [1, 0] },
    { name: 'vertical', start: [5, 3], dir: [0, 1] },
    { name: 'diagonal down-right', start: [3, 3], dir: [1, 1] },
    { name: 'diagonal down-left', start: [10, 3], dir: [-1, 1] },
  ];
  for (const { name, start, dir } of cases) {
    const [sx, sy] = start;
    const [dx, dy] = dir;
    const cells = line(sx, sy, dx, dy, 5, X);
    // Leave the middle stone out and place it last.
    const [mx, my] = cells.splice(2, 1)[0];
    const state = place(stateWith(cells), X, mx, my);
    assert.equal(state.winner, X, name);
    assert.equal(state.winLine.length, 5, name);
    assert.equal(isGameOver(state), true, name);
  }
});

test('the placing stone can be at either end of the line', () => {
  let state = place(stateWith(line(1, 2, 0, 1, 4, O), O), O, 1, 6);
  assert.equal(state.winner, O);
  state = place(stateWith(line(1, 3, 0, 1, 4, O), O), O, 1, 2);
  assert.equal(state.winner, O);
});

test('O wins too', () => {
  const state = place(stateWith(line(2, 2, 1, 1, 4, O), O), O, 6, 6);
  assert.equal(state.winner, O);
  assert.deepEqual(state.winLine, line(2, 2, 1, 1, 5, O).map(([x, y]) => ({ x, y })));
});

test('four in a row does not win', () => {
  const state = place(stateWith(line(0, 0, 1, 0, 3, X)), X, 3, 0);
  assert.equal(state.winner, null);
  assert.equal(state.currentPlayer, O);
});

test('six in a row wins (five or more)', () => {
  const cells = line(2, 7, 1, 0, 6, X);
  const [mx, my] = cells.splice(3, 1)[0];
  const state = place(stateWith(cells), X, mx, my);
  assert.equal(state.winner, X);
  assert.equal(state.winLine.length, 6);
});

test('joining two short lines into six or more wins', () => {
  // X X X _ X X X  -> filling the gap makes seven.
  const cells = [...line(0, 9, 1, -1, 3, X), ...line(4, 5, 1, -1, 3, X)];
  const state = place(stateWith(cells), X, 3, 6);
  assert.equal(state.winner, X);
  assert.equal(state.winLine.length, 7);
});

test('wins along every board edge', () => {
  const last = BOARD_SIZE - 1;
  const cases = [
    { name: 'top edge', cells: line(last - 4, 0, 1, 0, 5, X) },
    { name: 'bottom edge', cells: line(0, last, 1, 0, 5, X) },
    { name: 'left edge', cells: line(0, 0, 0, 1, 5, X) },
    { name: 'right edge', cells: line(last, last - 4, 0, 1, 5, X) },
    { name: 'main diagonal to corner', cells: line(last - 4, last - 4, 1, 1, 5, X) },
    { name: 'anti diagonal to corner', cells: line(last, 0, -1, 1, 5, X) },
  ];
  for (const { name, cells } of cases) {
    // Place the stone that sits on the edge or corner last.
    const [ex, ey] = cells.pop();
    const state = place(stateWith(cells), X, ex, ey);
    assert.equal(state.winner, X, name);
  }
});

test('a full-length edge row of 15 wins', () => {
  const cells = line(0, BOARD_SIZE - 1, 1, 0, BOARD_SIZE, X);
  const [ex, ey] = cells.splice(7, 1)[0];
  const state = place(stateWith(cells), X, ex, ey);
  assert.equal(state.winner, X);
  assert.equal(state.winLine.length, BOARD_SIZE);
});

test('lines do not wrap around the board edge', () => {
  // Three at the end of row 4 and two at the start of row 5.
  const last = BOARD_SIZE - 1;
  const cells = [...line(last - 2, 4, 1, 0, 3, X), [0, 5, X]];
  const state = place(stateWith(cells), X, 1, 5);
  assert.equal(state.winner, null);
});

test('an opponent stone blocks a line', () => {
  // X X O X X X : only four X on each side at most.
  const cells = [...line(0, 0, 1, 0, 2, X), [2, 0, O], ...line(4, 0, 1, 0, 2, X)];
  const state = place(stateWith(cells), X, 3, 0);
  assert.equal(state.winner, null);
});

test('a rock breaks a line', () => {
  // X X ROCK X X in each direction, then fill beside it to make four.
  const cases = [
    { name: 'horizontal', dir: [1, 0] },
    { name: 'vertical', dir: [0, 1] },
    { name: 'diagonal down-right', dir: [1, 1] },
    { name: 'diagonal down-left', dir: [-1, 1] },
  ];
  for (const { name, dir } of cases) {
    const [dx, dy] = dir;
    const sx = 7 - 3 * dx;
    const sy = 7 - 3 * dy;
    const cells = line(sx, sy, dx, dy, 7, X); // positions 0..6
    cells[3] = [cells[3][0], cells[3][1], ROCK]; // rock in the middle
    const [px, py] = cells.splice(2, 1)[0]; // place next to the rock
    const state = place(stateWith(cells), X, px, py);
    assert.equal(state.winner, null, name);
    assert.equal(findWinLine(state.board, X), null, name);
  }
});

test('a rock counts for neither colour', () => {
  const cells = [...line(0, 3, 1, 0, 4, X), [4, 3, ROCK]];
  assert.equal(findWinLine(stateWith(cells).board, X), null);
  const oCells = [...line(0, 3, 1, 0, 4, O), [4, 3, ROCK]];
  assert.equal(findWinLine(stateWith(oCells).board, O), null);
  assert.equal(findWinLineAt(stateWith([[4, 3, ROCK]]).board, 4, 3), null);
});

test('only the acting player can win on their move', () => {
  const state = place(stateWith(line(0, 0, 1, 0, 4, O)), X, 4, 0);
  assert.equal(state.winner, null);
  assert.equal(state.board[0][4], X);
});

test('findWinLine scans the whole board for a player', () => {
  const board = stateWith(line(5, 10, 1, -1, 5, O)).board;
  assert.equal(findWinLine(board, X), null);
  assert.equal(findWinLine(board, O).length, 5);
});

// --- Draw detection ---

// A full board pattern with no five in a row for either colour.
function drawPattern(x, y) {
  return (Math.floor(x / 2) + y) % 2 ? X : O;
}

test('filling the last cell without a win is a draw', () => {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (x !== 14 || y !== 14) cells.push([x, y, drawPattern(x, y)]);
    }
  }
  const player = drawPattern(14, 14);
  const before = stateWith(cells, player);
  assert.equal(isBoardFull(before.board), false);
  const state = place(before, player, 14, 14);
  assert.equal(isBoardFull(state.board), true);
  assert.equal(findWinLine(state.board, X), null);
  assert.equal(findWinLine(state.board, O), null);
  assert.equal(state.winner, null);
  assert.equal(state.draw, true);
  assert.equal(isGameOver(state), true);
});

test('rocks count as filled cells for a draw', () => {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (x !== 0 || y !== 0) cells.push([x, y, ROCK]);
    }
  }
  const state = place(stateWith(cells), X, 0, 0);
  assert.equal(state.draw, true);
});

test('a win on the last empty cell is a win, not a draw', () => {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (x !== 0 || y !== 0) cells.push([x, y, ROCK]);
    }
  }
  // Clear a line of four X next to the last empty cell.
  for (let x = 1; x <= 4; x++) cells.push([x, 0, X]);
  const state = place(stateWith(cells), X, 0, 0);
  assert.equal(state.winner, X);
  assert.equal(state.draw, false);
});

test('a board with empty cells left is not a draw', () => {
  const state = place(createInitialState(), X, 0, 0);
  assert.equal(state.draw, false);
  assert.equal(isGameOver(state), false);
});
