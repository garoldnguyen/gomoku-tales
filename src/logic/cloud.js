// Cloud Eagle (docs/design.md section 5). Two skills:
// - SKY WATCH (passive): the cells where the opponent would make five in a
//   row (SKY_WATCH_RUN, four) with one move (skyWatchCells).
// - CLOUD: a cloud on any cell of the board, stone and rock cells too. It
//   places no stone and does not end the owner's turn (Free Action: the
//   owner still plants). It covers CLOUD_SIZE by
//   CLOUD_SIZE cells centred on the chosen cell, clipped to the board, and
//   lasts CLOUD_TURNS turns of its owner (not counting the turn it is
//   placed in), then disappears. Stones placed inside stay; rocks are not
//   affected.
// A cloud is { x, y, owner, turnsLeft, placedTurn }; the game keeps them in
// state.clouds (missing until the first cloud).

import { CLOUD_SIZE, CLOUD_TURNS, SKY_WATCH_RUN } from '../config.js';
import { EMPTY, HIDDEN, X, O, cloneBoard, findWinLineAt, inBounds } from './board.js';
import { CLOUD, TORNADO_ZONE } from './skills.js';

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

// SKY WATCH (owner's rule, October 2026): the empty cells where the
// opponent of owner would make SKY_WATCH_RUN (four) or more in a row with
// one move, across, down or diagonally, on the full board (clouds do not
// hide anything here), so the eagle sees a three about to become a four,
// and a four about to become five too. Rocks break a line. Row by row, as
// [{ x, y }].
const RUN_DIRECTIONS = Object.freeze([[1, 0], [0, 1], [1, 1], [1, -1]]);
export function skyWatchCells(state, owner) {
  const opponent = owner === X ? O : X;
  const { board } = state;
  const same = (x, y) => inBounds(board, x, y) && board[y][x] === opponent;
  const cells = [];
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      if (board[y][x] !== EMPTY) continue;
      const makesRun = RUN_DIRECTIONS.some(([dx, dy]) => {
        let run = 1;
        for (let k = 1; same(x + dx * k, y + dy * k); k++) run++;
        for (let k = 1; same(x - dx * k, y - dy * k); k++) run++;
        return run >= SKY_WATCH_RUN;
      });
      if (makesRun) cells.push({ x, y });
    }
  }
  return cells;
}

// HIDDEN CLOUD CONTENTS: a stone or rock under a cloud is seen only by the
// seat that owns the cloud (docs/design.md section 6). maskForViewer(state,
// viewer) is the state as viewer (X or O) may see it: every cell under a
// cloud of the other seat is covered and listed in covered ([{ x, y }], row
// by row). A covered cell that holds a plant or a rock becomes HIDDEN (the
// viewer knows the plot is taken, not by what or whose); an empty one stays
// empty, so the viewer may plant there (owner's rule, October 2026). The winning line leaves out its
// covered cells too, so a win does not tell where a hidden stone is. The
// owner of a cloud sees everything under it; any other viewer (a
// spectator, null) sees the full state. Returns state itself when
// nothing is covered. The host keeps the true state; this is only what is
// shown and sent.
//
// HIDDEN TORNADO ZONE (owner's rule): only the player who cast a Tornado
// Zone may see where it is. For the other seat the zone becomes
// { player, hidden: true } with no centre and no cells.
export function maskForViewer(state, viewer) {
  if (!state || (viewer !== X && viewer !== O)) return state;
  const covered = coveredCells(state, viewer);
  const zone = state.tornado;
  const hideZone = Boolean(zone) && zone.player !== viewer && zone.hidden !== true;
  if (covered.length === 0) return hideZone ? { ...state, tornado: hiddenZone(zone) } : state;
  const board = cloneBoard(state.board);
  for (const { x, y } of covered) board[y][x] = board[y][x] === EMPTY ? EMPTY : HIDDEN;
  const masked = { ...state, board, covered };
  if (hideZone) masked.tornado = hiddenZone(zone);
  if (Array.isArray(state.rocks)) masked.rocks = state.rocks.filter((rock) => !isCovered(masked, rock.x, rock.y));
  if (Array.isArray(state.winLine)) masked.winLine = uncoveredOf(masked, state.winLine);
  const dash = state.pendingDash;
  if (dash && dash.player !== viewer && (isCovered(masked, dash.from?.x, dash.from?.y) || isCovered(masked, dash.to?.x, dash.to?.y))) {
    masked.pendingDash = null;
  }
  return masked;
}

// A Tornado Zone as the other seat sees it: that one was cast, not where.
function hiddenZone(zone) {
  return { player: zone.player, hidden: true, endsAfterTurn: zone.endsAfterTurn };
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
  const zoneHidden = masked?.tornado?.hidden === true;
  if ((!masked?.covered && !zoneHidden) || !Array.isArray(events)) return events;
  let changed = false;
  const kept = [];
  for (const event of events) {
    if (zoneHidden && event?.type === 'skillUsed' && event.skill === TORNADO_ZONE) {
      changed = true; // the cast shows, not where
      kept.push({ ...event, target: null });
    } else if (zoneHidden && event?.type === 'tornadoAnnounced') {
      changed = true;
      kept.push({ type: 'tornadoAnnounced', player: event.player, hidden: true });
    } else if (masked.covered && hidesEvent(masked, event)) {
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
// messages: a move under the other seat's cloud plays no effect. A skill
// does not end the turn (Free Action), so right after one the caster is
// still to move and sees all of it, a secret Tornado Zone included. What
// outlives the turn is kept right by the renderer: it draws the zone from
// the viewer's state (effects.syncTornado), so the swirl is gone the moment
// the turn passes to the other seat.
export function localViewEvents(state, events) {
  return maskEventsForViewer(localViewState(state), events);
}

// The answer to an action refused by the rules, as viewer may hear it: when
// the action names a cell covered for viewer (its x, y or the target's x,
// y, from or to), the error is COVERED_ERROR whatever the cell holds, so
// the refusal does not tell a stone from a rock. Otherwise error itself.
export const COVERED_ERROR = 'That cell is under a cloud.';

export function maskErrorForViewer(state, viewer, action, error) {
  if (action?.kind === 'place') return error; // the viewer sees whether a covered plot is taken
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
  if (action?.kind === 'place') return null; // planting in the other seat's cloud is allowed
  return namesCoveredCell(state, player, action) ? COVERED_ERROR : null;
}

function namesCoveredCell(state, viewer, action) {
  const masked = maskForViewer(state, viewer);
  if (!masked?.covered || !action) return false;
  const at = (point) => point != null && isCovered(masked, point.x, point.y);
  const target = action.target;
  return at(action) || at(target) || at(target?.from) || at(target?.to);
}
