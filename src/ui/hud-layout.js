// Where the glass HUD's player cards go (docs/art-direction-v3.md section 8)
// so they never lie over the board's plots and take its clicks. Pure (no
// DOM): src/ui/hud.js calls hudLayout() when the window size changes.
//
// The 3D view fills the whole window (docs/art-direction-v3-1.md section
// 3), and so does the HUD. The cards are 332 px wide, 56 px from the sides
// and 120 px from the top at full size. Where the
// space beside the board is narrower they shrink (scale), and below 700 px
// wide, or when they would have to shrink so far that the skill rows lose
// their 44 px touch height, they become the slim bars (compact) with 48 px
// skill buttons. The bars sit at the bottom; where that would cover the
// board (a small landscape window) they stand upright in the strips beside
// it instead (rail). Only if neither fits do the bottom bars lie over the
// board, so the touch targets never drop under 44 px.

import { BOARD_SIZE, CELL_SIZE } from '../config.js';
import { gameCamera, projectToNdc } from '../render3d/camera.js';

export const CARD_WIDTH = 332;
export const CARD_SIDE = 56;
export const CARD_TOP = 120;
// The full card's height (the DOM measures the real one when it can).
export const CARD_HEIGHT = 424;
// Space kept clear between a card and the plots, and the window edges.
export const HUD_GAP = 12;
// A skill row is 86 px tall at full size; below this scale it is under 44 px.
export const MIN_CARD_SCALE = 0.55;
// Below this window width the cards are slim bars (hud.css .is-compact).
export const COMPACT_WIDTH = 700;
// The slim bars: the lower bar 12 px from the bottom, the upper one 80 px,
// each 72 px tall, so together they take the bottom 152 px.
export const BARS_HEIGHT = 152;
// The upright bars (rail): their top, below the turn pill and quality
// switch, their height with the two skill buttons side by side or stacked,
// and the narrowest strip each layout needs (hud.css .is-rail).
export const RAIL_TOP = 76;
export const RAIL_HEIGHT_ROW = 168;
export const RAIL_HEIGHT_STACKED = 224;
export const RAIL_WIDTH_ROW = 124;
export const RAIL_WIDTH_STACKED = 108;
const RAIL_WIDTH_MAX = 180;

// The rectangle around the board's plots in window pixels: its corners
// seen through the game camera at the window's shape (camera.js, the same
// camera the world draws with, whose view widens for narrow windows).
// Called when the window size changes, not per frame.
export function boardScreenRect(viewW, viewH) {
  const setup = gameCamera(viewW / viewH);
  const half = (BOARD_SIZE * CELL_SIZE) / 2;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const x of [-half, half]) {
    for (const z of [-half, half]) {
      const ndc = projectToNdc({ x, y: 0, z }, setup);
      left = Math.min(left, ((ndc.x + 1) / 2) * viewW);
      right = Math.max(right, ((ndc.x + 1) / 2) * viewW);
      top = Math.min(top, ((1 - ndc.y) / 2) * viewH);
      bottom = Math.max(bottom, ((1 - ndc.y) / 2) * viewH);
    }
  }
  return { left, right, top, bottom };
}

const FULL = Object.freeze({ compact: false, rail: false, railWidth: 0, stacked: false, scale: 1 });
const BARS = Object.freeze({ ...FULL, compact: true });

// Returns { compact, rail, railWidth, stacked, scale }: compact for the slim
// bars, rail when they stand upright beside the board (railWidth px wide,
// stacked when the two skill buttons go one above the other), else the
// cards at `scale` (1 is full size, never under MIN_CARD_SCALE; the side
// margin shrinks with them).
export function hudLayout(viewW, viewH, cardHeight = CARD_HEIGHT) {
  const board = boardScreenRect(viewW, viewH);
  const besideBoard = (board.left - HUD_GAP) / (CARD_SIDE + CARD_WIDTH);
  const belowTop = (viewH - CARD_TOP - HUD_GAP) / Math.max(1, cardHeight);
  const scale = Math.min(1, besideBoard, belowTop);
  if (viewW >= COMPACT_WIDTH && scale >= MIN_CARD_SCALE) return scale === 1 ? FULL : { ...FULL, scale };
  if (viewH - BARS_HEIGHT - HUD_GAP >= board.bottom) return BARS;
  const strip = Math.min(RAIL_WIDTH_MAX, board.left - 2 * HUD_GAP);
  const height = viewH - RAIL_TOP - HUD_GAP;
  if (strip >= RAIL_WIDTH_ROW && height >= RAIL_HEIGHT_ROW) {
    return { ...BARS, rail: true, railWidth: Math.floor(strip) };
  }
  if (strip >= RAIL_WIDTH_STACKED && height >= RAIL_HEIGHT_STACKED) {
    return { ...BARS, rail: true, railWidth: Math.floor(strip), stacked: true };
  }
  return BARS;
}
