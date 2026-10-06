// Wind Rabbit skill effects (docs/design.md section 5.1). Each effect takes
// the state, the acting player and the target and returns either
// { error } or the state fields it changes plus { events, changed } where
// `changed` is the cell whose stone changed (for the win check), or null.

import { TORNADO_SIZE } from '../config.js';
import { EMPTY, O, X, cloneBoard, inBounds, isEmptyCell } from './board.js';

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
// clipped by the board edges. It gathers through the opponent's next turn
// and then blows every plant in it away (blowZone, run by finishTurn in
// game.js).
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

// The storm of a Tornado Zone (docs/design.md section 5.1), after the
// opponent's next turn: every plant in the zone, of either player and the
// one just planted there too, is blown to a random empty plot outside the
// zone. Plants go in row order, each to a plot still empty when its turn
// comes, so two never share one. A plant with no empty plot left outside
// the zone stays where it is. Rocks stay. random() returns a number in
// [0, 1) like Math.random. Returns { board, events, moves } where moves is
// [{ player, from, to }] for the plants that flew.
export function blowZone(board, tornado, random) {
  const next = cloneBoard(board);
  const zone = new Set(tornado.cells.map((cell) => `${cell.x},${cell.y}`));
  const plants = tornado.cells.filter((cell) => next[cell.y][cell.x] === X || next[cell.y][cell.x] === O);
  const lifted = plants.map((cell) => ({ player: next[cell.y][cell.x], from: { x: cell.x, y: cell.y } }));
  for (const cell of plants) next[cell.y][cell.x] = EMPTY;
  const events = [];
  const moves = [];
  for (const plant of lifted) {
    const options = [];
    for (let y = 0; y < next.length; y++) {
      for (let x = 0; x < next[y].length; x++) {
        if (next[y][x] === EMPTY && !zone.has(`${x},${y}`)) options.push({ x, y });
      }
    }
    if (options.length === 0) {
      next[plant.from.y][plant.from.x] = plant.player;
      events.push({ type: 'throwBlocked', player: plant.player, x: plant.from.x, y: plant.from.y });
      continue;
    }
    const index = Math.min(options.length - 1, Math.max(0, Math.floor(random() * options.length)));
    const to = options[index];
    next[to.y][to.x] = plant.player;
    moves.push({ player: plant.player, from: plant.from, to });
    events.push({ type: 'stoneThrown', player: plant.player, from: plant.from, to });
  }
  return {
    board: next,
    moves,
    events: [{ type: 'tornadoStorm', player: tornado.player, x: tornado.x, y: tornado.y, cells: tornado.cells, count: lifted.length }, ...events],
  };
}
