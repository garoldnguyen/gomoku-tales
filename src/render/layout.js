// Pure screen geometry for the game screen (docs/design.md section 3.1).
// No DOM access, so it can be unit tested under Node.

import { BOARD_SIZE, CELL_PX, INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config.js';
import { X, O } from '../logic/board.js';

export const BOARD_PX = BOARD_SIZE * CELL_PX;
export const BOARD_X = Math.floor((INTERNAL_WIDTH - BOARD_PX) / 2);
export const BOARD_Y = Math.floor((INTERNAL_HEIGHT - BOARD_PX) / 2);
export const BOARD_FRAME_PX = 6;
export const STATUS_Y = BOARD_Y + BOARD_PX + 26;
export const MESSAGE_Y = STATUS_Y + 24;

// Player panels: Wind Rabbit (X) on the left, Earth Bear (O) on the right,
// as tall as the framed board and PANEL_GAP px away from it.
const PANEL_GAP = 24;
export const PANEL_W = 240;
export const PANEL_H = BOARD_PX + BOARD_FRAME_PX * 2;
export const PANEL_Y = BOARD_Y - BOARD_FRAME_PX;
const PANEL_X = {
  [X]: BOARD_X - BOARD_FRAME_PX - PANEL_GAP - PANEL_W,
  [O]: BOARD_X + BOARD_PX + BOARD_FRAME_PX + PANEL_GAP,
};

// Positions inside a panel, relative to its top-left corner.
export const PORTRAIT_PX = 96;
export const PORTRAIT_Y = 20;
export const NAME_Y = 136;
export const STONE_LINE_Y = 160;
const BUTTON_X = 12;
const BUTTON_Y = 186;
export const BUTTON_W = PANEL_W - BUTTON_X * 2;
export const BUTTON_H = 64;
const BUTTON_STEP = BUTTON_H + 12;
export const SKILL_ICON_PX = 32;

export function panelRect(player) {
  return { x: PANEL_X[player], y: PANEL_Y, w: PANEL_W, h: PANEL_H };
}

// Rect of the player's skill button number `index` (0 or 1).
export function skillButtonRect(player, index) {
  return { x: PANEL_X[player] + BUTTON_X, y: PANEL_Y + BUTTON_Y + index * BUTTON_STEP, w: BUTTON_W, h: BUTTON_H };
}

// The skill button under an internal-resolution point as { player, index },
// or null.
export function skillButtonAt(px, py, skillsPerPlayer = 2) {
  for (const player of [X, O]) {
    for (let index = 0; index < skillsPerPlayer; index++) {
      const { x, y, w, h } = skillButtonRect(player, index);
      if (px >= x && px < x + w && py >= y && py < y + h) return { player, index };
    }
  }
  return null;
}

// Top-left pixel of a board cell.
export function cellOrigin(x, y) {
  return { px: BOARD_X + x * CELL_PX, py: BOARD_Y + y * CELL_PX };
}

// Centre pixel of a board cell.
export function cellCenter(x, y) {
  return { px: BOARD_X + x * CELL_PX + CELL_PX / 2, py: BOARD_Y + y * CELL_PX + CELL_PX / 2 };
}

// Board cell under an internal-resolution point, or null if off the board.
export function cellAtPoint(px, py) {
  if (px < BOARD_X || py < BOARD_Y) return null;
  const x = Math.floor((px - BOARD_X) / CELL_PX);
  const y = Math.floor((py - BOARD_Y) / CELL_PX);
  if (x >= BOARD_SIZE || y >= BOARD_SIZE) return null;
  return { x, y };
}
