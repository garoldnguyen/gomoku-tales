// Wind Rabbit skill effects (docs/free-action-design.md section 4). Each
// effect takes the state, the acting player and the target and returns either
// { error } or the state fields it changes plus { events, changed } where
// `changed` is the cell whose stone changed (for the win check), or null.

import { TORNADO_ARM, TORNADO_TURNS, WIND_DASH_RANGE } from '../config.js';
import { EMPTY, cloneBoard, inBounds, isEmptyCell } from './board.js';
import { SUNK_PLANT_ERROR, mudAt } from './earth-bear-skills.js';
import { isPoisoned } from './jade-serpent-skills.js';
import { isSunk } from './scoring-board.js';

export const DASH_TOO_FAR_ERROR = 'That cell is too far for Wind Dash.';
export const DASH_ON_MUD_ERROR = 'A Wind Dash cannot land on mud.';
export const DASH_ON_POISON_ERROR = 'A Wind Dash cannot land on poison.';

// Cells between two cells counting a diagonal step as one (Chebyshev).
export function dashDistance(from, to) {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
}

// WIND DASH: announce a move of one of the player's plants (not a sunk seed)
// to an empty plot that is not mud and not poisoned, 1 to WIND_DASH_RANGE
// cells away. Nothing moves now; the dash resolves at the end of the
// opponent's next turn (see resolveDash). target = { from: { x, y }, to: { x, y } }.
export function windDash(state, player, target) {
  const from = target?.from ?? {};
  const to = target?.to ?? {};
  if (!inBounds(state.board, from.x, from.y)) return { error: 'Choose one of your stones on the board.' };
  if (state.board[from.y][from.x] !== player) return { error: 'Choose one of your own stones.' };
  if (isSunk(state, from.x, from.y)) return { error: SUNK_PLANT_ERROR };
  if (!inBounds(state.board, to.x, to.y)) return { error: 'Choose a target cell on the board.' };
  if (dashDistance(from, to) > WIND_DASH_RANGE) return { error: DASH_TOO_FAR_ERROR };
  if (!isEmptyCell(state.board, to.x, to.y)) return { error: 'The target cell is not empty.' };
  if (mudAt(state, to.x, to.y)) return { error: DASH_ON_MUD_ERROR };
  if (isPoisoned(state, to.x, to.y)) return { error: DASH_ON_POISON_ERROR };

  const dash = { player, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, resolvesAfterTurn: state.turn + 1 };
  return {
    pendingDash: dash,
    events: [{ type: 'dashAnnounced', player, from: dash.from, to: dash.to }],
    changed: null,
  };
}

// Resolves a pending dash in the state. The stone moves only under the
// conditions of the announcement: the source still holds the dashing
// player's plant (not sunk) and the target is still empty, not mud and not
// poisoned. Returns { board, events, changed } with `changed` the landing
// cell, or null when the dash failed (sourceLost, targetTaken).
export function resolveDash(state, dash) {
  const { board } = state;
  const { player, from, to } = dash;
  if (board[from.y][from.x] !== player || isSunk(state, from.x, from.y)) {
    return { board, events: [{ type: 'dashFailed', player, from, to, reason: 'sourceLost' }], changed: null };
  }
  if (!isEmptyCell(board, to.x, to.y) || mudAt(state, to.x, to.y) || isPoisoned(state, to.x, to.y)) {
    return { board, events: [{ type: 'dashFailed', player, from, to, reason: 'targetTaken' }], changed: null };
  }
  const next = cloneBoard(board);
  next[from.y][from.x] = EMPTY;
  next[to.y][to.x] = player;
  return { board: next, events: [{ type: 'dashResolved', player, from, to }], changed: { x: to.x, y: to.y } };
}

// TORNADO ZONE: a secret trap in the shape of a cross (section 4): the
// centre cell and the TORNADO_ARM cells in each of the four directions,
// clipped by the board edges. It is armed from the end of the cast turn T
// (armedAfterTurn) and waits through the opponent's next turn and the
// caster's next one (endsAfterTurn = T + TORNADO_TURNS). A seed ANY player
// plants on a cell of the cross while it is armed fires it (throwStone).
// Only the caster sees the cross (maskForViewer in cloud.js hides it from
// the other seat until it fires).
export function tornadoZone(state, player, target) {
  const { x, y } = target ?? {};
  if (!inBounds(state.board, x, y)) return { error: 'Choose a zone centre on the board.' };

  const cells = tornadoCells(state.board, x, y);
  return {
    tornado: { player, x, y, cells, armedAfterTurn: state.turn, endsAfterTurn: state.turn + TORNADO_TURNS },
    events: [{ type: 'tornadoAnnounced', player, x, y, cells }],
    changed: null,
  };
}

// The cells of the cross centred on (x, y) that lie on the board, row by row.
export function tornadoCells(board, x, y) {
  const cells = [];
  for (let cy = y - TORNADO_ARM; cy <= y + TORNADO_ARM; cy++) {
    for (let cx = x - TORNADO_ARM; cx <= x + TORNADO_ARM; cx++) {
      if ((cx === x || cy === y) && inBounds(board, cx, cy)) cells.push({ x: cx, y: cy });
    }
  }
  return cells;
}

export function inTornado(tornado, x, y) {
  return tornado.cells.some((cell) => cell.x === x && cell.y === y);
}

// True when a seed planted at (x, y) in the state's turn fires the trap:
// the state holds a visible trap (cells known), it is armed (the cast turn
// is over) and its time is not over, and (x, y) is a cell of the cross.
// The planting player does not matter: the caster's own seed fires it too.
export function tornadoFires(state, x, y) {
  const { tornado } = state;
  if (!tornado || !Array.isArray(tornado.cells)) return false;
  if (state.turn <= tornado.armedAfterTurn || state.turn > tornado.endsAfterTurn) return false;
  return inTornado(tornado, x, y);
}

// The Tornado Zone throw (section 4): the seed just planted at (x, y) in
// state.board fired the trap. Events: tornadoStorm (the cross, now known to
// everybody), then the host's random() (a number in [0, 1) like Math.random)
// picks one of the 8 neighbours of (x, y) that is empty, not mud and not
// poisoned: stoneThrown { player, from, to }; with none the seed stays
// (throwBlocked). The trap is used up (the caller drops state.tornado).
// Returns { board, events, changed } with `changed` the cell where the seed
// ends up.
export function throwStone(state, x, y, random) {
  const { board, tornado } = state;
  const player = board[y][x];
  const storm = { type: 'tornadoStorm', player: tornado.player, x: tornado.x, y: tornado.y, cells: tornado.cells };
  const options = [];
  for (let cy = y - 1; cy <= y + 1; cy++) {
    for (let cx = x - 1; cx <= x + 1; cx++) {
      if ((cx !== x || cy !== y) && isEmptyCell(board, cx, cy) && !mudAt(state, cx, cy) && !isPoisoned(state, cx, cy)) options.push({ x: cx, y: cy });
    }
  }
  if (options.length === 0) {
    return { board, events: [storm, { type: 'throwBlocked', player, x, y }], changed: { x, y } };
  }
  const index = Math.min(options.length - 1, Math.max(0, Math.floor(random() * options.length)));
  const to = options[index];
  const next = cloneBoard(board);
  next[y][x] = EMPTY;
  next[to.y][to.x] = player;
  return { board: next, events: [storm, { type: 'stoneThrown', player, from: { x, y }, to }], changed: to };
}
