// Pure board helpers. The board is a 2D array indexed board[y][x].
// Each cell is EMPTY (null), X, O or ROCK.

import { BOARD_SIZE, WIN_LENGTH } from '../config.js';

export const EMPTY = null;
export const X = 'X';
export const O = 'O';
export const ROCK = 'ROCK';
// A cell under the other seat's cloud that holds a plant or a rock: only in
// a board masked for a viewer (maskForViewer in cloud.js). Not empty, and
// neither X, O nor a rock, so it never counts for a line.
export const HIDDEN = 'HIDDEN';

// Horizontal, vertical, diagonal down-right, diagonal down-left.
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

export function createBoard(size = BOARD_SIZE) {
  return Array.from({ length: size }, () => Array(size).fill(EMPTY));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function inBounds(board, x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && y >= 0 && y < board.length && x >= 0 && x < board[y].length;
}

// A cell is empty if it holds no stone and no rock.
export function isEmptyCell(board, x, y) {
  return inBounds(board, x, y) && board[y][x] === EMPTY;
}

export function isBoardFull(board) {
  return board.every((row) => row.every((cell) => cell !== EMPTY));
}

// Returns the full unbroken line of the stone at (x, y) as [{x, y}, ...]
// if it is WIN_LENGTH or longer in any direction, otherwise null.
// Rocks, empty cells and the other colour all break a line.
export function findWinLineAt(board, x, y, winLength = WIN_LENGTH) {
  if (!inBounds(board, x, y)) return null;
  const player = board[y][x];
  if (player !== X && player !== O) return null;

  for (const [dx, dy] of DIRECTIONS) {
    let sx = x;
    let sy = y;
    while (inBounds(board, sx - dx, sy - dy) && board[sy - dy][sx - dx] === player) {
      sx -= dx;
      sy -= dy;
    }
    const line = [];
    let cx = sx;
    let cy = sy;
    while (inBounds(board, cx, cy) && board[cy][cx] === player) {
      line.push({ x: cx, y: cy });
      cx += dx;
      cy += dy;
    }
    if (line.length >= winLength) return line;
  }
  return null;
}

// Scans the whole board for a winning line of the given player.
export function findWinLine(board, player, winLength = WIN_LENGTH) {
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      if (board[y][x] !== player) continue;
      const line = findWinLineAt(board, x, y, winLength);
      if (line) return line;
    }
  }
  return null;
}
