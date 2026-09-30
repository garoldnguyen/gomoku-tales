// Earth Bear skill effects (docs/design.md section 5.2). Each effect takes
// the state, the acting player and the target and returns either
// { error } or { board, rocks, events, changed } where `changed` is the
// cell whose stone changed (for the win check), or null.

import { ROCK_LIFETIME_TURNS } from '../config.js';
import { EMPTY, ROCK, X, O, cloneBoard, inBounds, isEmptyCell } from './board.js';

// TERRAIN CREATION: a rock falls onto any empty cell at once. It lasts for
// the ROCK_LIFETIME_TURNS turns that follow this one and breaks at the end
// of the last of them.
export function terrainCreation(state, player, target) {
  const { x, y } = target ?? {};
  if (!inBounds(state.board, x, y)) return { error: 'Choose a cell on the board.' };
  if (!isEmptyCell(state.board, x, y)) return { error: 'That cell is not empty.' };

  const board = cloneBoard(state.board);
  board[y][x] = ROCK;
  const rock = { x, y, breaksAfterTurn: state.turn + ROCK_LIFETIME_TURNS };
  return {
    board,
    rocks: [...state.rocks, rock],
    events: [{ type: 'rockPlaced', player, x, y, breaksAfterTurn: rock.breaksAfterTurn }],
    changed: null,
  };
}

// STONE CONVERSION: one opponent stone becomes the player's stone at once.
// The caller runs the win check on the converted cell.
export function stoneConversion(state, player, target) {
  const { x, y } = target ?? {};
  if (!inBounds(state.board, x, y)) return { error: 'Choose a cell on the board.' };
  const opponent = player === X ? O : X;
  if (state.board[y][x] !== opponent) return { error: 'Choose one of your opponent\'s stones.' };

  const board = cloneBoard(state.board);
  board[y][x] = player;
  return {
    board,
    rocks: state.rocks,
    events: [{ type: 'stoneConverted', player, x, y, from: opponent }],
    changed: { x, y },
  };
}

// Removes the rocks whose lifetime ends with the given turn. Returns the
// new board and rocks list and a rockBroken event for each broken rock.
export function breakRocks(board, rocks, turn) {
  const broken = rocks.filter((rock) => rock.breaksAfterTurn <= turn);
  if (broken.length === 0) return { board, rocks, events: [] };

  const next = cloneBoard(board);
  for (const { x, y } of broken) {
    if (next[y][x] === ROCK) next[y][x] = EMPTY;
  }
  return {
    board: next,
    rocks: rocks.filter((rock) => rock.breaksAfterTurn > turn),
    events: broken.map(({ x, y }) => ({ type: 'rockBroken', x, y })),
  };
}
