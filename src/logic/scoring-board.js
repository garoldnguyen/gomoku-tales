// The scoring board (docs/free-action-design.md section 2): the board as the
// lines see it. A seed sunk in mud (state.sunk) holds its plot but counts
// for nobody, so its cell becomes the neutral SUNK marker and breaks every
// line like a rock. EVERY win check, the draw check and Sky Watch read this
// board, never state.board.

import { SUNK } from './board.js';

// True when (x, y) holds a seed that is still sunk.
export function isSunk(state, x, y) {
  return (state?.sunk ?? []).some((seed) => seed.x === x && seed.y === y);
}

// state.board itself when nothing is sunk, otherwise a copy with each sunk
// cell set to SUNK.
export function scoringBoard(state) {
  const sunk = state?.sunk ?? [];
  if (sunk.length === 0) return state.board;
  const board = state.board.map((row) => row.slice());
  for (const { x, y, player } of sunk) {
    if (board[y]?.[x] === player) board[y][x] = SUNK;
  }
  return board;
}
