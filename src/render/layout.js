// Pure screen geometry for the game screen (docs/design.md section 3.1).
// No DOM access, so it can be unit tested under Node.

import { BOARD_SIZE, CELL_PX, INTERNAL_WIDTH, INTERNAL_HEIGHT, PORTRAIT_PX, SKILL_ICON_PX } from '../config.js';
import { X, O } from '../logic/board.js';

export { PORTRAIT_PX, SKILL_ICON_PX }; // sprite sizes, kept in config

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

// Positions inside a panel, relative to its top-left corner.
export const PORTRAIT_Y = 20;
export const NAME_Y = 136;
export const STONE_LINE_Y = 160;
const BUTTON_X = 12;
export const BUTTON_W = PANEL_W - BUTTON_X * 2;
export const BUTTON_H = 64;

// A HUD layout: where the player panels, their skill buttons and the status
// lines go. portraitY null means the panel has no portrait.
export const HUD_2D = Object.freeze({
  panelX: Object.freeze({
    [X]: BOARD_X - BOARD_FRAME_PX - PANEL_GAP - PANEL_W,
    [O]: BOARD_X + BOARD_PX + BOARD_FRAME_PX + PANEL_GAP,
  }),
  panelY: PANEL_Y,
  panelW: PANEL_W,
  panelH: PANEL_H,
  portraitY: PORTRAIT_Y,
  nameY: NAME_Y,
  nameSize: 18,
  stoneLineY: STONE_LINE_Y,
  buttonX: BUTTON_X,
  buttonY: 186,
  buttonW: BUTTON_W,
  buttonH: BUTTON_H,
  buttonStep: BUTTON_H + 12,
  statusY: STATUS_Y,
  messageY: MESSAGE_Y,
});

// HUD over the 3D world (docs/art-direction-hd2d.md section F). The board
// fills the middle of the screen and the characters stand beside it, so
// smaller panels without portraits (the characters stand in the world
// above them) sit in the bottom corners and the status lines go below the
// board's near edge.
const HUD_3D_PANEL_W = 212;
const HUD_3D_PANEL_H = 222;
const HUD_3D_MARGIN = 6;
export const HUD_3D = Object.freeze({
  panelX: Object.freeze({
    [X]: HUD_3D_MARGIN + 2,
    [O]: INTERNAL_WIDTH - HUD_3D_MARGIN - 2 - HUD_3D_PANEL_W,
  }),
  panelY: INTERNAL_HEIGHT - HUD_3D_MARGIN - HUD_3D_PANEL_H,
  panelW: HUD_3D_PANEL_W,
  panelH: HUD_3D_PANEL_H,
  portraitY: null,
  nameY: 22,
  nameSize: 16,
  stoneLineY: 44,
  buttonX: BUTTON_X,
  buttonY: 60,
  buttonW: HUD_3D_PANEL_W - BUTTON_X * 2,
  buttonH: BUTTON_H,
  buttonStep: BUTTON_H + 12,
  statusY: INTERNAL_HEIGHT - 40,
  messageY: INTERNAL_HEIGHT - 17,
});

export function panelRect(player, layout = HUD_2D) {
  return { x: layout.panelX[player], y: layout.panelY, w: layout.panelW, h: layout.panelH };
}

// Rect of the player's skill button number `index` (0 or 1).
export function skillButtonRect(player, index, layout = HUD_2D) {
  return {
    x: layout.panelX[player] + layout.buttonX,
    y: layout.panelY + layout.buttonY + index * layout.buttonStep,
    w: layout.buttonW,
    h: layout.buttonH,
  };
}

// The skill button under an internal-resolution point as { player, index },
// or null.
export function skillButtonAt(px, py, skillsPerPlayer = 2, layout = HUD_2D) {
  for (const player of [X, O]) {
    for (let index = 0; index < skillsPerPlayer; index++) {
      const { x, y, w, h } = skillButtonRect(player, index, layout);
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
