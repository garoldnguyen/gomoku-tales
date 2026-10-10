// Click-to-target flows for skills (docs/design.md sections 3.1 and 5).
// Pure (no DOM). A targeting value is { skill, from } where `from` is the
// chosen source stone for Wind Dash and null otherwise. The rules module
// still validates the finished action; these checks only guide the clicks.

import { WIND_DASH_RANGE } from '../config.js';
import { X, O, isEmptyCell, inBounds } from '../logic/board.js';
import { WIND_DASH, TORNADO_ZONE, MUD_TRAP, PETRIFICATION, HISS, VENOM, CLOUD } from '../logic/skills.js';
import { cloudCells } from '../logic/cloud.js';
import { SUNK_PLANT_ERROR, mudAt } from '../logic/earth-bear-skills.js';
import { isSunk } from '../logic/scoring-board.js';
import { isPoisoned } from '../logic/jade-serpent-skills.js';
import { DASH_ON_MUD_ERROR, DASH_ON_POISON_ERROR, dashDistance, tornadoCells } from '../logic/wind-rabbit-skills.js';
import { STRINGS } from './strings.js';

// Skills used at once on the button click, with no target flow.
const NO_TARGET_SKILLS = new Set([HISS]);

// True when the skill needs a board target before it can be used.
export function needsTarget(skillId) {
  return !NO_TARGET_SKILLS.has(skillId);
}

export function startTargeting(skillId) {
  return { skill: skillId, from: null };
}

// Status line prompt for the current targeting step.
export function targetPrompt(targeting) {
  switch (targeting.skill) {
    case WIND_DASH:
      return targeting.from ? 'Wind Dash: choose an empty target cell' : 'Wind Dash: choose one of your stones';
    case TORNADO_ZONE:
      return STRINGS.tornadoTargetPrompt;
    case MUD_TRAP:
      return 'Mud Trap: choose an empty cell';
    case PETRIFICATION:
      return "Petrification: choose an opponent's stone";
    case VENOM:
      return "Venom: choose an opponent's stone";
    case CLOUD:
      return STRINGS.cloudTargetPrompt;
    default:
      return 'Choose a target';
  }
}

// Handles a board click while targeting. Returns one of:
//   { target }    the target is complete, ready for useSkill
//   { targeting } the flow moves to another step
//   { error }     the cell is not a valid choice; the step stays the same
export function targetClick(state, player, targeting, cell) {
  const { board } = state;
  const { x, y } = cell;
  if (!inBounds(board, x, y)) return { error: 'Choose a cell on the board.' };
  const content = board[y][x];

  switch (targeting.skill) {
    case WIND_DASH: {
      const { from } = targeting;
      if (!from) {
        if (content !== player) return { error: 'Choose one of your own stones.' };
        if (isSunk(state, x, y)) return { error: SUNK_PLANT_ERROR };
        return { targeting: { ...targeting, from: { x, y } } };
      }
      // Clicking the chosen stone again un-picks it; another own stone
      // becomes the new source.
      if (from.x === x && from.y === y) return { targeting: { ...targeting, from: null } };
      if (content === player && !isSunk(state, x, y)) return { targeting: { ...targeting, from: { x, y } } };
      if (dashDistance(from, cell) > WIND_DASH_RANGE) return { error: STRINGS.windDashTooFarError };
      if (!isEmptyCell(board, x, y)) return { error: 'Choose an empty target cell.' };
      if (mudAt(state, x, y)) return { error: DASH_ON_MUD_ERROR };
      if (isPoisoned(state, x, y)) return { error: DASH_ON_POISON_ERROR };
      return { target: { from, to: { x, y } } };
    }
    case TORNADO_ZONE:
    case CLOUD:
      return { target: { x, y } };
    case MUD_TRAP:
      if (!isEmptyCell(board, x, y)) return { error: 'Choose an empty cell.' };
      if (mudAt(state, x, y)) return { error: 'That cell is already mud.' };
      return { target: { x, y } };
    case PETRIFICATION:
    case VENOM:
      if (content !== opponentOf(player)) return { error: "Choose one of your opponent's stones." };
      if (targeting.skill === PETRIFICATION && isSunk(state, x, y)) return { error: SUNK_PLANT_ERROR };
      return { target: { x, y } };
    default:
      return { error: 'Unknown skill.' };
  }
}

// What to draw on the board for the targeting step under the hovered cell
// (hover may be null). Returns null or one of:
//   { type: 'select', x, y }       ring around a stone that can be picked, or the plot Mud Trap would flood
//   { type: 'dash', from, to }     whirl on the source, red frame on `to` (or null)
//   { type: 'zone', x, y, cells }  the Tornado Zone cross centred on (x, y) and its cells (cut at the edges)
//   { type: 'cloud', x, y, cells } the Cloud centred on (x, y) and its cells
export function targetPreview(state, player, targeting, hover) {
  const { board } = state;
  const cell = hover && inBounds(board, hover.x, hover.y) ? hover : null;
  const content = cell ? board[cell.y][cell.x] : undefined;

  switch (targeting.skill) {
    case WIND_DASH: {
      const { from } = targeting;
      if (!from) return content === player && !isSunk(state, cell.x, cell.y) ? { type: 'select', x: cell.x, y: cell.y } : null;
      const to = cell && dashDistance(from, cell) <= WIND_DASH_RANGE && isEmptyCell(board, cell.x, cell.y)
        && !mudAt(state, cell.x, cell.y) && !isPoisoned(state, cell.x, cell.y) ? { x: cell.x, y: cell.y } : null;
      return { type: 'dash', from, to };
    }
    case TORNADO_ZONE:
      return cell ? { type: 'zone', x: cell.x, y: cell.y, cells: tornadoCells(board, cell.x, cell.y) } : null;
    case CLOUD:
      return cell ? { type: 'cloud', x: cell.x, y: cell.y, cells: cloudCells(board, cell) } : null;
    case MUD_TRAP:
      return cell && isEmptyCell(board, cell.x, cell.y) && !mudAt(state, cell.x, cell.y) ? { type: 'select', x: cell.x, y: cell.y } : null;
    case PETRIFICATION:
      return content === opponentOf(player) && !isSunk(state, cell.x, cell.y) ? { type: 'select', x: cell.x, y: cell.y } : null;
    case VENOM:
      return content === opponentOf(player) ? { type: 'select', x: cell.x, y: cell.y } : null;
    default:
      return null;
  }
}

function opponentOf(player) {
  return player === X ? O : X;
}
