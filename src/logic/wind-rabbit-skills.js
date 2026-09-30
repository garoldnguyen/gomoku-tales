// Wind Rabbit skill effects (docs/design.md section 5.1). Each effect takes
// the state, the acting player and the target and returns either
// { error } or the state fields it changes plus { events, changed } where
// `changed` is the cell whose stone changed (for the win check), or null.

import { TORNADO_SIZE } from '../config.js';
import { EMPTY, cloneBoard, inBounds, isEmptyCell } from './board.js';

// WIND DASH: announce a move of one of the player's stones to an empty
// cell. Nothing moves now; the dash resolves at the end of the opponent's
// next turn (see resolveDash). target = { from: { x, y }, to: { x, y } }.
export function windDash(state, player, target) {
  const from = target?.from ?? {};
  const to = target?.to ?? {};
  if (!inBounds(state.board, from.x, from.y)) return { error: 'Choose one of your stones on the board.' };
  if (state.board[from.y][from.x] !== player) return { error: 'Choose one of your own stones.' };
  if (!inBounds(state.board, to.x, to.y)) return { error: 'Choose a target cell on the board.' };
  if (!isEmptyCell(state.board, to.x, to.y)) return { error: 'The target cell is not empty.' };

  const dash = { player, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, resolvesAfterTurn: state.turn + 1 };
  return {
    pendingDash: dash,
    events: [{ type: 'dashAnnounced', player, from: dash.from, to: dash.to }],
    changed: null,
  };
}

// Resolves a pending dash on the given board. The stone moves only if the
// source still holds the dashing player's stone and the target is still
// empty. Returns { board, events, changed } with `changed` the landing
// cell, or null when the dash failed.
export function resolveDash(board, dash) {
  const { player, from, to } = dash;
  if (board[from.y][from.x] !== player) {
    return { board, events: [{ type: 'dashFailed', player, from, to, reason: 'sourceLost' }], changed: null };
  }
  if (!isEmptyCell(board, to.x, to.y)) {
    return { board, events: [{ type: 'dashFailed', player, from, to, reason: 'targetTaken' }], changed: null };
  }
  const next = cloneBoard(board);
  next[from.y][from.x] = EMPTY;
  next[to.y][to.x] = player;
  return { board: next, events: [{ type: 'dashResolved', player, from, to }], changed: { x: to.x, y: to.y } };
}

// TORNADO ZONE: a TORNADO_SIZE square zone around any cell on the board,
// clipped by the board edges. It lasts through the opponent's next turn.
export function tornadoZone(state, player, target) {
  const { x, y } = target ?? {};
  if (!inBounds(state.board, x, y)) return { error: 'Choose a zone centre on the board.' };

  const cells = tornadoCells(state.board, x, y);
  return {
    tornado: { player, x, y, cells, endsAfterTurn: state.turn + 1 },
    events: [{ type: 'tornadoAnnounced', player, x, y, cells }],
    changed: null,
  };
}

// The cells of the zone centred on (x, y) that lie on the board.
export function tornadoCells(board, x, y) {
  const half = Math.floor(TORNADO_SIZE / 2);
  const cells = [];
  for (let cy = y - half; cy <= y + half; cy++) {
    for (let cx = x - half; cx <= x + half; cx++) {
      if (inBounds(board, cx, cy)) cells.push({ x: cx, y: cy });
    }
  }
  return cells;
}

export function inTornado(tornado, x, y) {
  return tornado.cells.some((cell) => cell.x === x && cell.y === y);
}

// Throws the stone at (x, y) to a random empty neighbour (up to 8 cells,
// in row order). random() returns a number in [0, 1) like Math.random.
// If no neighbour is empty the stone stays. Returns { board, events,
// changed } with `changed` the cell where the stone ends up.
export function throwStone(board, x, y, random) {
  const player = board[y][x];
  const options = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx !== 0 || dy !== 0) && isEmptyCell(board, x + dx, y + dy)) options.push({ x: x + dx, y: y + dy });
    }
  }
  if (options.length === 0) {
    return { board, events: [{ type: 'throwBlocked', player, x, y }], changed: { x, y } };
  }

  const index = Math.min(options.length - 1, Math.max(0, Math.floor(random() * options.length)));
  const to = options[index];
  const next = cloneBoard(board);
  next[y][x] = EMPTY;
  next[to.y][to.x] = player;
  return { board: next, events: [{ type: 'stoneThrown', player, from: { x, y }, to }], changed: to };
}
