// Jade Serpent skill effects (docs/design.md section 5.3). Each effect takes
// the state, the acting player and the target and returns either
// { error } or the state fields it changes plus { events, changed } where
// `changed` is the cell whose stone changed (for the win check), or null.

import { EMPTY, X, O, cloneBoard, inBounds } from './board.js';

// HISS: the opponent cannot use a skill on their next turn. They can still
// place a stone; the lock ends after that turn. No target.
export function hiss(state, player) {
  const opponent = player === X ? O : X;
  const skillLock = { player: opponent, endsAfterTurn: state.turn + 1 };
  return {
    skillLock,
    events: [{ type: 'hissCast', player, locked: opponent }],
    changed: null,
  };
}

// VENOM: one opponent plant withers at once and its plot is left empty.
// Rocks and the player's own plants cannot be targeted.
export function venom(state, player, target) {
  const { x, y } = target ?? {};
  if (!inBounds(state.board, x, y)) return { error: 'Choose a cell on the board.' };
  const opponent = player === X ? O : X;
  if (state.board[y][x] !== opponent) return { error: 'Choose one of your opponent\'s stones.' };

  const board = cloneBoard(state.board);
  board[y][x] = EMPTY;
  // A sunk seed that is withered has nothing left to surface, and a plant
  // set there later must count at once: its entry goes with the plant.
  const sunk = (state.sunk ?? []).filter((seed) => seed.x !== x || seed.y !== y);
  return {
    board,
    sunk,
    events: [{ type: 'plantRemoved', player, x, y, from: opponent }],
    changed: null,
  };
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
