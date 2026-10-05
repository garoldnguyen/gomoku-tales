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
import { CLOUD } from './skills.js';

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

// HIDDEN CLOUD CONTENTS: a stone or rock under a cloud is seen only by the
// seat that owns the cloud (docs/design.md section 6). maskForViewer(state,
// viewer) is the state as viewer (X or O) may see it: every cell under a
// cloud of the other seat is covered, with no stone and no rock, and listed
// in covered ([{ x, y }], row by row). The winning line leaves out its
// covered cells too, so a win does not tell where a hidden stone is. The
// owner of a cloud sees everything under it; any other viewer (a
// spectator, null) sees the full state. Returns state itself when
// nothing is covered. The host keeps the true state; this is only what is
// shown and sent.
export function maskForViewer(state, viewer) {
  if (!state || (viewer !== X && viewer !== O)) return state;
  const covered = coveredCells(state, viewer);
  if (covered.length === 0) return state;
  const board = cloneBoard(state.board);
  for (const { x, y } of covered) board[y][x] = EMPTY;
  const masked = { ...state, board, covered };
  if (Array.isArray(state.rocks)) masked.rocks = state.rocks.filter((rock) => !isCovered(masked, rock.x, rock.y));
  if (Array.isArray(state.winLine)) masked.winLine = uncoveredOf(masked, state.winLine);
  const dash = state.pendingDash;
  if (dash && dash.player !== viewer && (isCovered(masked, dash.from?.x, dash.from?.y) || isCovered(masked, dash.to?.x, dash.to?.y))) {
    masked.pendingDash = null;
  }
  return masked;
}

// The cells under the clouds of the seat other than viewer, row by row,
// each once.
export function coveredCells(state, viewer) {
  const hiding = cloudsOf(state).filter((c) => c.owner !== viewer);
  if (hiding.length === 0) return [];
  const cells = [];
  for (let y = 0; y < state.board.length; y++) {
    for (let x = 0; x < state.board[y].length; x++) {
      if (hiding.some((c) => inCloud(c, x, y))) cells.push({ x, y });
    }
  }
  return cells;
}

// The cells of the list that masked does not cover.
function uncoveredOf(masked, cells) {
  return cells.filter((cell) => !isCovered(masked, cell.x, cell.y));
}

// True when (x, y) is a covered cell of a state made by maskForViewer.
export function isCovered(state, x, y) {
  const covered = state?.covered;
  if (!covered) return false;
  for (const cell of covered) if (cell.x === x && cell.y === y) return true;
  return false;
}

// The events of an action as viewer may see them, after maskForViewer gave
// masked: an event that names a covered cell (its x, y, from, to or
// target) is left out, so no move under the other seat's cloud is told.
// The cloud itself is no secret: cloudPlaced, cloudEnded and the use of
// the cloud skill always stay. A win stays, but its line leaves out the
// covered cells. Returns events itself when nothing is changed.
export function maskEventsForViewer(masked, events) {
  if (!masked?.covered || !Array.isArray(events)) return events;
  let changed = false;
  const kept = [];
  for (const event of events) {
    if (hidesEvent(masked, event)) {
      changed = true;
    } else if (event?.type === 'win' && Array.isArray(event.line)) {
      const line = uncoveredOf(masked, event.line);
      if (line.length !== event.line.length) changed = true;
      kept.push(line.length === event.line.length ? event : { ...event, line });
    } else {
      kept.push(event);
    }
  }
  return changed ? kept : events;
}

const PUBLIC_EVENTS = Object.freeze(['cloudPlaced', 'cloudEnded', 'win', 'draw', 'turnEnded']);

function hidesEvent(masked, event) {
  if (PUBLIC_EVENTS.includes(event?.type)) return false;
  if (event.type === 'skillUsed' && event.skill === CLOUD) return false;
  const at = (point) => point != null && isCovered(masked, point.x, point.y);
  return at(event) || at(event.from) || at(event.to) || at(event.target);
}

// LOCAL MODE (two players on one screen): the board is shown to the player
// to move, so the cells under the other seat's cloud are covered while
// that player moves, and the owner's turn shows everything.
export function localViewState(state) {
  return maskForViewer(state, state?.currentPlayer);
}

// LOCAL MODE: the events of an action as the player to move next (in
// state, the state after the action) may see them, for the effects and
// messages: a move under the other seat's cloud plays no effect.
export function localViewEvents(state, events) {
  return maskEventsForViewer(localViewState(state), events);
}

// The answer to an action refused by the rules, as viewer may hear it: when
// the action names a cell covered for viewer (its x, y or the target's x,
// y, from or to), the error is COVERED_ERROR whatever the cell holds, so
// the refusal does not tell a stone from a rock. Otherwise error itself.
export const COVERED_ERROR = 'That cell is under a cloud.';

export function maskErrorForViewer(state, viewer, action, error) {
  return namesCoveredCell(state, viewer, action) ? COVERED_ERROR : error;
}

// The refusal of an action of player BEFORE the rules run, online: an
// action that names a cell under the other seat's cloud is refused with
// COVERED_ERROR whatever the cell holds (an empty covered cell too), so
// whether it is taken or accepted never tells what the cloud hides. The
// CLOUD skill is the exception: its result does not depend on the cell.
// Returns null when the action may go to the rules.
export function coveredActionError(state, player, action) {
  if (action?.kind === 'skill' && action.skill === CLOUD) return null;
  return namesCoveredCell(state, player, action) ? COVERED_ERROR : null;
}

function namesCoveredCell(state, viewer, action) {
  const masked = maskForViewer(state, viewer);
  if (!masked?.covered || !action) return false;
  const at = (point) => point != null && isCovered(masked, point.x, point.y);
  const target = action.target;
  return at(action) || at(target) || at(target?.from) || at(target?.to);
}
