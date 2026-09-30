// Pure screen geometry for the game screen (docs/design.md section 3.1).
// No DOM access, so it can be unit tested under Node.

import { BOARD_SIZE, CELL_PX, INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config.js';

export const BOARD_PX = BOARD_SIZE * CELL_PX;
export const BOARD_X = Math.floor((INTERNAL_WIDTH - BOARD_PX) / 2);
export const BOARD_Y = Math.floor((INTERNAL_HEIGHT - BOARD_PX) / 2);
export const STATUS_Y = BOARD_Y + BOARD_PX + 26;
export const MESSAGE_Y = STATUS_Y + 24;

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
