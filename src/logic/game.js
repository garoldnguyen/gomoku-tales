// Pure core rules (docs/design.md section 4). Actions never mutate the
// state they are given; they return { ok: true, state } with a new state,
// or { ok: false, error } when the action is not allowed.

import { BOARD_SIZE } from '../config.js';
import { X, O, cloneBoard, createBoard, inBounds, isBoardFull, isEmptyCell, findWinLineAt } from './board.js';

export function createInitialState(size = BOARD_SIZE) {
  return {
    board: createBoard(size),
    currentPlayer: X, // Wind Rabbit (X) always moves first
    winner: null,
    winLine: null,
    draw: false,
  };
}

export function isGameOver(state) {
  return state.winner !== null || state.draw;
}

export function otherPlayer(player) {
  return player === X ? O : X;
}

export function placeStone(state, action) {
  const { player, x, y } = action;
  if (isGameOver(state)) return fail('The game is over.');
  if (player !== state.currentPlayer) return fail('It is not your turn.');
  if (!inBounds(state.board, x, y)) return fail('That cell is off the board.');
  if (!isEmptyCell(state.board, x, y)) return fail('That cell is not empty.');

  const board = cloneBoard(state.board);
  board[y][x] = player;

  const winLine = findWinLineAt(board, x, y);
  if (winLine) {
    return { ok: true, state: { ...state, board, winner: player, winLine } };
  }
  if (isBoardFull(board)) {
    return { ok: true, state: { ...state, board, draw: true } };
  }
  return { ok: true, state: { ...state, board, currentPlayer: otherPlayer(player) } };
}

function fail(error) {
  return { ok: false, error };
}
