// Click-to-target flows for skills (docs/design.md sections 3.1 and 5).
// Pure (no DOM). A targeting value is { skill, from } where `from` is the
// chosen source stone for Wind Dash and null otherwise. The rules module
// still validates the finished action; these checks only guide the clicks.

import { X, O, isEmptyCell, inBounds } from '../logic/board.js';
import { WIND_DASH, TORNADO_ZONE, TERRAIN_CREATION, STONE_CONVERSION, HISS, VENOM } from '../logic/skills.js';
import { tornadoCells } from '../logic/wind-rabbit-skills.js';

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
      return 'Tornado Zone: choose the zone centre';
    case TERRAIN_CREATION:
      return 'Terrain Creation: choose an empty cell';
    case STONE_CONVERSION:
      return "Stone Conversion: choose an opponent's stone";
    case VENOM:
      return "Venom: choose an opponent's stone";
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
        return { targeting: { ...targeting, from: { x, y } } };
      }
      // Clicking the chosen stone again un-picks it; another own stone
      // becomes the new source.
      if (from.x === x && from.y === y) return { targeting: { ...targeting, from: null } };
      if (content === player) return { targeting: { ...targeting, from: { x, y } } };
      if (!isEmptyCell(board, x, y)) return { error: 'Choose an empty target cell.' };
      return { target: { from, to: { x, y } } };
    }
    case TORNADO_ZONE:
      return { target: { x, y } };
    case TERRAIN_CREATION:
      if (!isEmptyCell(board, x, y)) return { error: 'Choose an empty cell.' };
      return { target: { x, y } };
    case STONE_CONVERSION:
    case VENOM:
      if (content !== opponentOf(player)) return { error: "Choose one of your opponent's stones." };
      return { target: { x, y } };
    default:
      return { error: 'Unknown skill.' };
  }
}

// What to draw on the board for the targeting step under the hovered cell
// (hover may be null). Returns null or one of:
//   { type: 'select', x, y }       ring around a stone that can be picked
//   { type: 'dash', from, to }     whirl on the source, red frame on `to` (or null)
//   { type: 'zone', x, y, cells }  the Tornado Zone centred on (x, y) and its cells
//   { type: 'rock', x, y }         a ghost rock
export function targetPreview(state, player, targeting, hover) {
  const { board } = state;
  const cell = hover && inBounds(board, hover.x, hover.y) ? hover : null;
  const content = cell ? board[cell.y][cell.x] : undefined;

  switch (targeting.skill) {
    case WIND_DASH: {
      const { from } = targeting;
      if (!from) return content === player ? { type: 'select', x: cell.x, y: cell.y } : null;
      const to = cell && isEmptyCell(board, cell.x, cell.y) ? { x: cell.x, y: cell.y } : null;
      return { type: 'dash', from, to };
    }
    case TORNADO_ZONE:
      return cell ? { type: 'zone', x: cell.x, y: cell.y, cells: tornadoCells(board, cell.x, cell.y) } : null;
    case TERRAIN_CREATION:
      return cell && isEmptyCell(board, cell.x, cell.y) ? { type: 'rock', x: cell.x, y: cell.y } : null;
    case STONE_CONVERSION:
    case VENOM:
      return content === opponentOf(player) ? { type: 'select', x: cell.x, y: cell.y } : null;
    default:
      return null;
  }
}

function opponentOf(player) {
  return player === X ? O : X;
}
