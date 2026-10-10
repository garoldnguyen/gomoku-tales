// Earth Bear skill effects (docs/free-action-design.md section 3). Each
// effect takes the state, the acting player and the target and returns
// either { error } or the state fields it changes plus { events, changed }
// where `changed` is the cell whose stone changed (for the win check), or
// null. The mud helpers below are used by the turn code in game.js.

import { MUD_LIFETIME_TURNS, MUD_SINK_TURNS } from '../config.js';
import { ROCK, X, O, cloneBoard, inBounds, isEmptyCell } from './board.js';
import { isSunk } from './scoring-board.js';

export const SUNK_PLANT_ERROR = 'That plant is sunk in mud.';

// The mud puddle on (x, y), or null.
export function mudAt(state, x, y) {
  return (state.mud ?? []).find((puddle) => puddle.x === x && puddle.y === y) ?? null;
}

// MUD TRAP: an empty plot becomes a mud puddle. It dries at the end of the
// MUD_LIFETIME_TURNS-th turn after this one. A seed planted in it sinks
// (sinkSeed).
export function mudTrap(state, player, target) {
  const { x, y } = target ?? {};
  if (!inBounds(state.board, x, y)) return { error: 'Choose a cell on the board.' };
  if (!isEmptyCell(state.board, x, y)) return { error: 'That cell is not empty.' };
  if (mudAt(state, x, y)) return { error: 'That cell is already mud.' };

  const puddle = { x, y, player, driesAfterTurn: state.turn + MUD_LIFETIME_TURNS };
  return {
    mud: [...(state.mud ?? []), puddle],
    events: [{ type: 'mudPlaced', player, x, y, driesAfterTurn: puddle.driesAfterTurn }],
    changed: null,
  };
}

// PETRIFICATION: one plant of the opponent (not a sunk seed) becomes a
// permanent rock. A rock breaks every line and is never removed. A Wind Dash
// waiting to start from this plot fails on its own: the plot no longer
// holds the dasher's plant (resolveDash, sourceLost).
export function petrification(state, player, target) {
  const { x, y } = target ?? {};
  if (!inBounds(state.board, x, y)) return { error: 'Choose a cell on the board.' };
  const opponent = player === X ? O : X;
  if (state.board[y][x] !== opponent) return { error: 'Choose one of your opponent\'s stones.' };
  if (isSunk(state, x, y)) return { error: SUNK_PLANT_ERROR };

  const board = cloneBoard(state.board);
  board[y][x] = ROCK;
  return {
    board,
    rocks: [...(state.rocks ?? []), { x, y }],
    events: [{ type: 'stonePetrified', player, x, y, from: opponent }],
    changed: null,
  };
}

// A seed of player was just planted on (x, y) in the state: when that plot
// is a mud puddle the puddle is used up (no mudDried) and the seed is sunk
// until the end of the turn MUD_SINK_TURNS after this one. Returns
// { mud, sunk, events } or null when the plot is not mud.
export function sinkSeed(state, player, x, y) {
  const puddle = mudAt(state, x, y);
  if (!puddle) return null;
  const seed = { x, y, player, surfacesAfterTurn: state.turn + MUD_SINK_TURNS };
  return {
    mud: state.mud.filter((p) => p !== puddle),
    sunk: [...(state.sunk ?? []), seed],
    events: [{ type: 'stoneSunk', player, x, y, surfacesAfterTurn: seed.surfacesAfterTurn }],
  };
}

// Splits the sunk seeds at the end of `turn` into the ones that surface now
// and the ones that stay sunk. `all` surfaces every seed (the board is full,
// so nobody can plant any more). The acting player's own seeds come first,
// so their win is checked first. Returns { surfacing, sunk }.
export function surfacingSeeds(sunk, turn, actor, all = false) {
  const due = (seed) => all || seed.surfacesAfterTurn <= turn;
  const surfacing = sunk.filter(due).sort((a, b) => Number(b.player === actor) - Number(a.player === actor));
  return { surfacing, sunk: sunk.filter((seed) => !due(seed)) };
}

// Dries the puddles whose time ends with the given turn. Returns the new
// list and a mudDried event for each (the same array when nothing dries).
export function dryMud(mud, turn) {
  const dried = mud.filter((puddle) => puddle.driesAfterTurn <= turn);
  if (dried.length === 0) return { mud, events: [] };
  return {
    mud: mud.filter((puddle) => puddle.driesAfterTurn > turn),
    events: dried.map(({ player, x, y }) => ({ type: 'mudDried', player, x, y })),
  };
}
