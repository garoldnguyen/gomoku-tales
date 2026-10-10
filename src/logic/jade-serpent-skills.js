// Jade Serpent skill effects (docs/free-action-design.md section 5). Each
// effect takes the state, the acting player and the target and returns
// either { error } or the state fields it changes plus { events, changed }
// where `changed` is the cell whose stone changed (for the win check), or
// null.

import { HISS_LOCK_TURNS, VENOM_TURNS, VENOM_ZONE_SIZE } from '../config.js';
import { X, O, inBounds, isEmptyCell } from './board.js';

export const NO_ROOM_ERROR = 'There would be no room left to plant.';
export const POISONED_ERROR = 'That cell is poisoned.';

// HISS: the opponent cannot use a skill on their next turn (the lock lasts
// HISS_LOCK_TURNS turns, counted like state.turn). They can still plant a
// seed; the lock ends after that turn. No target.
export function hiss(state, player) {
  const opponent = player === X ? O : X;
  const skillLock = { player: opponent, endsAfterTurn: state.turn + HISS_LOCK_TURNS };
  return {
    skillLock,
    events: [{ type: 'hissCast', player, locked: opponent }],
    changed: null,
  };
}

// VENOM: the VENOM_ZONE_SIZE by VENOM_ZONE_SIZE square around one plant of
// the opponent (a seed sunk in mud too), clipped to the board, becomes a
// poison zone at once. Nobody may plant on an empty cell of it until it ends
// after turn state.turn + VENOM_TURNS. The plant itself stays and keeps
// counting. Rocks, empty plots and the player's own plants cannot be
// targeted. Refused when the zone would leave no empty plot to plant on, so
// the player to move can always plant.
export function venom(state, player, target) {
  const { x, y } = target ?? {};
  if (!inBounds(state.board, x, y)) return { error: 'Choose a cell on the board.' };
  const opponent = player === X ? O : X;
  if (state.board[y][x] !== opponent) return { error: 'Choose one of your opponent\'s stones.' };

  const cells = poisonCells(state.board, x, y);
  if (!hasPlantableCell({ board: state.board, poison: { cells } })) return { error: NO_ROOM_ERROR };
  const poison = { player, x, y, cells, endsAfterTurn: state.turn + VENOM_TURNS };
  return {
    poison,
    events: [{ type: 'poisonPlaced', player, x, y, cells, endsAfterTurn: poison.endsAfterTurn }],
    changed: null,
  };
}

// The cells of the VENOM_ZONE_SIZE square around (x, y) that lie on the
// board, row by row. The square is centred for an odd size; an even size
// reaches one cell further to the lower right, like the Cloud.
export function poisonCells(board, x, y) {
  const low = Math.floor((VENOM_ZONE_SIZE - 1) / 2);
  const high = VENOM_ZONE_SIZE - 1 - low;
  const cells = [];
  for (let cy = y - low; cy <= y + high; cy++) {
    for (let cx = x - low; cx <= x + high; cx++) {
      if (inBounds(board, cx, cy)) cells.push({ x: cx, y: cy });
    }
  }
  return cells;
}

// True when some plot of the state is empty and not poisoned: the player to
// move can plant there.
export function hasPlantableCell(state) {
  const { board } = state;
  for (let cy = 0; cy < board.length; cy++) {
    for (let cx = 0; cx < board[cy].length; cx++) {
      if (isEmptyCell(board, cx, cy) && !isPoisoned(state, cx, cy)) return true;
    }
  }
  return false;
}

// True when (x, y) lies in the poison zone of a Venom (state.poison, a
// missing field means no poison). Poison cells cannot be planted on, dashed
// to or hit by a Tornado throw (docs/free-action-design.md section 5).
export function isPoisoned(state, x, y) {
  const cells = state?.poison?.cells;
  return Array.isArray(cells) && cells.some((cell) => cell.x === x && cell.y === y);
}

// True when the player may not use a skill this turn because of a Hiss.
export function isSkillLocked(state, player) {
  return state.skillLock?.player === player;
}
