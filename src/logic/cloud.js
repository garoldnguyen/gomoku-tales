// Cloud Eagle (docs/design.md section 5). Two skills:
// - SKY WATCH (passive): the cells where the opponent would make five in a
//   row with one move (skyWatchCells).
// - CLOUD: a cloud on any cell of the board, stone and rock cells too. It
//   places no stone and uses the owner's turn. It covers CLOUD_SIZE by
//   CLOUD_SIZE cells centred on the chosen cell, clipped to the board, and
//   lasts CLOUD_TURNS turns of its owner (not counting the turn it is
//   placed in), then disappears. Stones placed inside stay; rocks are not
//   affected.
// A cloud is { x, y, owner, turnsLeft, placedTurn }; the game keeps them in
// state.clouds (missing until the first cloud).

import { CLOUD_SIZE, CLOUD_TURNS } from '../config.js';
import { EMPTY, X, O, cloneBoard, findWinLineAt, inBounds } from './board.js';

export function createCloud(x, y, owner, placedTurn) {
  return { x, y, owner, turnsLeft: CLOUD_TURNS, placedTurn };
}

// The active clouds of the state.
export function cloudsOf(state) {
  return state.clouds ?? [];
}

// True when the cell (x, y) lies under the cloud.
export function inCloud(cloud, x, y) {
  const half = Math.floor(CLOUD_SIZE / 2);
  return Math.abs(x - cloud.x) <= half && Math.abs(y - cloud.y) <= half;
}

// The cells the cloud covers, clipped to the board, row by row.
export function cloudCells(board, cloud) {
  const half = Math.floor(CLOUD_SIZE / 2);
  const cells = [];
  for (let y = cloud.y - half; y <= cloud.y + half; y++) {
    for (let x = cloud.x - half; x <= cloud.x + half; x++) {
      if (inBounds(board, x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

// The CLOUD skill effect (same shape as the other skill effects): any cell
// of the board, empty or not.
export function cloud(state, player, target) {
  const { x, y } = target ?? {};
  if (!inBounds(state.board, x, y)) return { error: 'Choose a cell on the board.' };
  const placed = createCloud(x, y, player, state.turn);
  return {
    clouds: [...cloudsOf(state), placed],
    events: [{ type: 'cloudPlaced', player, x, y, cells: cloudCells(state.board, placed) }],
    changed: null,
  };
}

// Ends a turn of the player for the clouds: each of their clouds placed
// before this turn loses one turn, and a cloud with none left disappears.
// Returns { clouds, events }; clouds is the same array when nothing changed.
export function tickClouds(clouds, player, turn) {
  if (!clouds.some((c) => c.owner === player && c.placedTurn !== turn)) return { clouds, events: [] };
  const kept = [];
  const events = [];
  for (const c of clouds) {
    if (c.owner !== player || c.placedTurn === turn) {
      kept.push(c);
    } else if (c.turnsLeft > 1) {
      kept.push({ ...c, turnsLeft: c.turnsLeft - 1 });
    } else {
      events.push({ type: 'cloudEnded', player, x: c.x, y: c.y });
    }
  }
  return { clouds: kept, events };
}

// SKY WATCH: the empty cells where the opponent of owner would make five in
// a row with one move, by the game's win rule on the full board (clouds do
// not hide anything here). Row by row, as [{ x, y }].
export function skyWatchCells(state, owner) {
  const opponent = owner === X ? O : X;
  const board = cloneBoard(state.board);
  const cells = [];
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      if (board[y][x] !== EMPTY) continue;
      board[y][x] = opponent;
      if (findWinLineAt(board, x, y)) cells.push({ x, y });
      board[y][x] = EMPTY;
    }
  }
  return cells;
}
