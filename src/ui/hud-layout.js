// Where the glass HUD's player cards go (docs/art-direction-v3.md section 8)
// so they never lie over the board's plots and take its clicks. Pure (no
// DOM): src/ui/hud.js calls hudLayout() when the window size changes.
//
// The 3D view fills the whole window (docs/art-direction-v3-1.md section
// 3), and so does the HUD. The cards are HUD_CARD_WIDTH_PX (250) wide, at
// most HUD_CARD_HEIGHT_PX (310) tall, 56 px from the sides and 120 px from
// the top at full size (src/config.js). Where the
// space beside the board is narrower they shrink (scale), and below 700 px
// wide, or when they would have to shrink so far that the skill rows lose
// their 44 px touch height, they become the slim bars (compact) with 48 px
// skill buttons. The bars sit at the bottom; where that would cover the
// board (a small landscape window) they stand upright in the strips beside
// it instead (rail). Only if neither fits do the bottom bars lie over the
// board, so the touch targets never drop under 44 px.

import {
  BOARD_SIZE, CELL_SIZE, HUD_CARD_HEIGHT_PX, HUD_CARD_SIDE_PX, HUD_CARD_TOP_PX, HUD_CARD_WIDTH_PX, HUD_SKILL_ROW_PX,
} from '../config.js';
import { gameCamera, projectToNdc } from '../render3d/camera.js';

export const CARD_WIDTH = HUD_CARD_WIDTH_PX;
export const CARD_SIDE = HUD_CARD_SIDE_PX;
export const CARD_TOP = HUD_CARD_TOP_PX;
// The full card's height: the most it may take with both skill rows (the
// DOM measures the real one when it can, and it is drawn shorter).
export const CARD_HEIGHT = HUD_CARD_HEIGHT_PX;
// Space kept clear between a card and the plots, and the window edges.
export const HUD_GAP = 12;
// A skill row is HUD_SKILL_ROW_PX tall at full size; below this scale it
// is under 44 px.
export const MIN_CARD_SCALE = 44 / HUD_SKILL_ROW_PX;
// Below this window width the cards are slim bars (hud.css .is-compact).
export const COMPACT_WIDTH = 700;
// The slim bars (hud.css .is-compact): each BAR_HEIGHT px tall with its
// border, the lower one 12 px from the bottom, the upper one BAR_GAP px
// above it, so together they take the bottom BARS_HEIGHT px.
export const BAR_HEIGHT = 72;
export const BAR_GAP = 8;
export const BAR_BOTTOM = 12;
export const BARS_HEIGHT = BAR_BOTTOM + 2 * BAR_HEIGHT + BAR_GAP;
// The upright bars (rail): their top, below the turn pill and quality
// switch, their height with the two skill buttons side by side or stacked,
// and the narrowest strip each layout needs (hud.css .is-rail).
export const RAIL_TOP = 76;
export const RAIL_HEIGHT_ROW = 168;
export const RAIL_HEIGHT_STACKED = 224;
export const RAIL_WIDTH_ROW = 124;
export const RAIL_WIDTH_STACKED = 108;
const RAIL_WIDTH_MAX = 180;

// A collapsed card (docs/art-direction-v3-1.md section 4.1, hud.css
// .is-collapsed): one pill at the card's anchor. Padding 8, gap 8: the 56 px
// portrait tile, two 56 px skill buttons, the 44 px chevron (4 px more space
// before it) and a 1 px border. (72 px tiles before the owner asked for a
// smaller pill.)
export const PILL_PAD = 8;
export const PILL_TILE = 56;
export const CHEVRON_SIZE = 44;
export const PILL_WIDTH = 2 * PILL_PAD + 3 * PILL_TILE + 3 * PILL_PAD + 4 + CHEVRON_SIZE + 2;
export const PILL_HEIGHT = 2 * PILL_PAD + PILL_TILE + 2;
// The pill's skill buttons keep a 44 px touch target, so it never shrinks
// below this scale even where the cards do.
export const MIN_PILL_SCALE = 44 / PILL_TILE;
// The portrait tile of the full card; its row grows when the chevron is taller.
export const CARD_TILE = 56;

// The top bar (hud.css), for hudBoxes(): the quality switch at its widest
// (the full and the slim size), the turn pill's room and heights. The turn
// pill's text decides its real width; these are its limits.
export const TOP_BAR_TOP = 28;
export const QUALITY_RIGHT = 40;
export const QUALITY_WIDTH = 252;
export const QUALITY_HEIGHT = 56;
export const TURN_HEIGHT = 50;
export const TURN_WIDTH = 600;
// The Fullscreen button (docs/art-direction-v3-1.md section 3.5): a 44 px
// square left of the quality switch, TOOL_GAP px from it, centred on its
// height. Hidden where the browser has no Fullscreen API.
export const FULLSCREEN_SIZE = 44;
export const TOOL_GAP = 8;
const FULLSCREEN_ROOM = FULLSCREEN_SIZE + TOOL_GAP;
// Full cards: the turn pill keeps this much room free on each side for the
// quality switch and the Fullscreen button (hud.css .turn max-width).
export const TURN_SIDE_ROOM = QUALITY_RIGHT + QUALITY_WIDTH + FULLSCREEN_ROOM + HUD_GAP;
export const COMPACT_EDGE = 12;
export const QUALITY_COMPACT_WIDTH = 180;
export const QUALITY_COMPACT_HEIGHT = 54;
// Slim layout: the turn pill sits at the top left and stops this far from
// the right edge, left of the quality switch (and of the Fullscreen button
// beside it, TURN_COMPACT_RIGHT_FS). Where that would leave the pill under
// TURN_COMPACT_MIN px (narrow phones) the button goes under the quality
// switch instead (fullscreenBelow), except beside the upright rail cards,
// which start right under the switch.
// The Leave match button (docs/flow-design.md section 3.13), a 44 px glass
// circle like the Fullscreen button: on full cards in the top left corner,
// in the slim layouts left of the Fullscreen button (in the row, or under
// the switch with it on narrow phones).
export const LEAVE_SIZE = FULLSCREEN_SIZE;
const LEAVE_ROOM = LEAVE_SIZE + TOOL_GAP;
export const TURN_COMPACT_RIGHT = 216;
export const TURN_COMPACT_RIGHT_LEAVE = TURN_COMPACT_RIGHT + LEAVE_ROOM; // no Fullscreen button: the Leave button in the row
export const TURN_COMPACT_RIGHT_FS = TURN_COMPACT_RIGHT_LEAVE + FULLSCREEN_ROOM;
export const TURN_COMPACT_MIN = 160;
// Its height with the hint on one line, and on two (narrow phones).
export const TURN_COMPACT_HEIGHT = 56;
export const TURN_COMPACT_HEIGHT_TALL = 88;
const TURN_COMPACT_ONE_LINE = 400; // px of room the hint needs to fit one line

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

// The scale of a collapsed pill: the cards' scale, smaller where the pill
// (wider than the card) would reach the plots of a viewW by viewH window
// (when given), but never under MIN_PILL_SCALE.
export function pillScale(scale, viewW, viewH) {
  let s = scale;
  if (viewW !== undefined && viewH !== undefined) {
    // On screen the pill is (PILL_WIDTH - CHEVRON_SIZE) * s wide plus the
    // chevron, which stays CHEVRON_SIZE (chevronSize).
    const room = boardScreenRect(viewW, viewH).left - HUD_GAP - CARD_SIDE * scale - CHEVRON_SIZE;
    s = Math.min(s, room / (PILL_WIDTH - CHEVRON_SIZE));
  }
  return Math.max(s, MIN_PILL_SCALE);
}

// The chevron's size in the card's own (unscaled) pixels, so that it stays
// a CHEVRON_SIZE touch target on screen inside a card or pill drawn at
// `scale` (hud.css --chevron-card and --chevron-pill).
export function chevronSize(scale) {
  return scale > 0 && scale < 1 ? CHEVRON_SIZE / scale : CHEVRON_SIZE;
}

// A pill's and a full card's size in window pixels at the cards' scale.
export function pillBox(scale, viewW, viewH) {
  const s = pillScale(scale, viewW, viewH);
  return { w: (PILL_WIDTH - CHEVRON_SIZE + chevronSize(s)) * s, h: PILL_HEIGHT * s };
}
export function cardBox(scale, cardHeight = CARD_HEIGHT) {
  const grow = Math.max(0, chevronSize(scale) - CARD_TILE);
  return { w: CARD_WIDTH * scale, h: (cardHeight + grow) * scale };
}

// True when a pill fits beside the board at this layout with its 44 px
// buttons and chevron: never in the slim layouts, and not in the small
// windows where the cards are drawn so small that the pill (whose buttons
// and chevron do not shrink below 44 px) would reach over the plots. There
// the cards stay full and the chevron hides, like in the slim layouts.
export function canFold(viewW, viewH, layout) {
  if (layout.compact) return false;
  const side = CARD_SIDE * layout.scale;
  return side + pillBox(layout.scale, viewW, viewH).w + HUD_GAP <= boardScreenRect(viewW, viewH).left + 1e-9;
}

// The layout hud.js uses: hudLayout() for the full card, or for the pill
// height when every card is folded and the pills fit. Returns the layout
// plus `foldable` (canFold) and `folded`, the flags of the cards drawn as
// pills ({ X, O }).
export function hudFoldLayout(viewW, viewH, { collapsed = {}, cardHeight = CARD_HEIGHT } = {}) {
  let layout = hudLayout(viewW, viewH, cardHeight);
  let foldable = canFold(viewW, viewH, layout);
  if (foldable && collapsed.X && collapsed.O) {
    const pills = hudLayout(viewW, viewH, PILL_HEIGHT);
    if (canFold(viewW, viewH, pills)) layout = pills;
  }
  const folded = { X: foldable && Boolean(collapsed.X), O: foldable && Boolean(collapsed.O) };
  return { layout, foldable, folded };
}

// The top bar rectangles hud.css draws, in window pixels, for a layout of
// hudLayout() (worked out here when not given): { turn, quality, fullscreen,
// leave, fullscreenBelow, toolsBelow }, each box { name, x, y, w, h } (the names of their
// data-hud-box attributes). fullscreen is null when the button is hidden
// (no Fullscreen API); fullscreenBelow is true when it sits under the
// quality switch (hud.css .fs-below). The turn pill's text decides its real
// width; this is its widest.
export function topBarLayout(viewW, viewH, layout = hudLayout(viewW, viewH), { fullscreen = true } = {}) {
  const room = fullscreen ? FULLSCREEN_ROOM : 0;
  if (!layout.compact) {
    const quality = { name: 'quality', x: viewW - QUALITY_RIGHT - QUALITY_WIDTH, y: TOP_BAR_TOP, w: QUALITY_WIDTH, h: QUALITY_HEIGHT };
    const turnW = Math.min(TURN_WIDTH, viewW - 2 * (TURN_SIDE_ROOM - FULLSCREEN_ROOM + room));
    const turn = { name: 'turn', x: (viewW - turnW) / 2, y: TOP_BAR_TOP, w: turnW, h: TURN_HEIGHT };
    const slot = { x: quality.x - TOOL_GAP - FULLSCREEN_SIZE, y: TOP_BAR_TOP + (QUALITY_HEIGHT - FULLSCREEN_SIZE) / 2 };
    const button = fullscreen ? { name: 'fullscreen', ...slot, w: FULLSCREEN_SIZE, h: FULLSCREEN_SIZE } : null;
    // the top left corner, mirroring the tools (the turn pill keeps TURN_SIDE_ROOM free there)
    const leave = { name: 'leave-match', x: QUALITY_RIGHT, y: slot.y, w: LEAVE_SIZE, h: LEAVE_SIZE };
    return { turn, quality, fullscreen: button, leave, fullscreenBelow: false, toolsBelow: false };
  }
  const quality = {
    name: 'quality', x: viewW - COMPACT_EDGE - QUALITY_COMPACT_WIDTH, y: COMPACT_EDGE, w: QUALITY_COMPACT_WIDTH, h: QUALITY_COMPACT_HEIGHT,
  };
  // On narrow phones the buttons go under the switch (toolsBelow).
  const below = !layout.rail && viewW - COMPACT_EDGE - (TURN_COMPACT_RIGHT_LEAVE + room) < TURN_COMPACT_MIN;
  const turnW = Math.min(TURN_WIDTH, viewW - COMPACT_EDGE - (below ? TURN_COMPACT_RIGHT : TURN_COMPACT_RIGHT_LEAVE + room));
  const turnH = turnW >= TURN_COMPACT_ONE_LINE ? TURN_COMPACT_HEIGHT : TURN_COMPACT_HEIGHT_TALL;
  const turn = { name: 'turn', x: COMPACT_EDGE, y: COMPACT_EDGE, w: turnW, h: turnH };
  let button = null;
  if (below && fullscreen) {
    button = {
      name: 'fullscreen', x: viewW - COMPACT_EDGE - FULLSCREEN_SIZE, y: quality.y + quality.h + TOOL_GAP, w: FULLSCREEN_SIZE, h: FULLSCREEN_SIZE,
    };
  } else if (fullscreen) {
    button = {
      name: 'fullscreen', x: quality.x - TOOL_GAP - FULLSCREEN_SIZE, y: COMPACT_EDGE + (QUALITY_COMPACT_HEIGHT - FULLSCREEN_SIZE) / 2, w: FULLSCREEN_SIZE, h: FULLSCREEN_SIZE,
    };
  }
  const under = quality.y + quality.h + TOOL_GAP;
  let leave;
  if (below) {
    const right = button ? button.x - TOOL_GAP : quality.x + quality.w;
    leave = { name: 'leave-match', x: right - LEAVE_SIZE, y: under, w: LEAVE_SIZE, h: LEAVE_SIZE };
  } else {
    leave = { name: 'leave-match', x: (button ?? quality).x - TOOL_GAP - LEAVE_SIZE, y: COMPACT_EDGE + (QUALITY_COMPACT_HEIGHT - LEAVE_SIZE) / 2, w: LEAVE_SIZE, h: LEAVE_SIZE };
  }
  return { turn, quality, fullscreen: button, leave, fullscreenBelow: below && fullscreen, toolsBelow: below };
}

// The HUD rectangles hud.css draws for a layout, as [{ name, x, y, w, h }]
// in window pixels (the names of their data-hud-box attributes): the turn
// pill, the quality switch, the Fullscreen button (unless `fullscreen` is
// false: no Fullscreen API), the Leave match button (unless `leave` is
// false: a spectator) and each team's card, or its pill when
// collapsed[team] is true and the pills fit (canFold). The slim layouts have
// no pills: there the cards stay bars whatever is saved. For tests and the
// screenshot check.
export function hudBoxes(viewW, viewH, { collapsed = {}, cardHeight = CARD_HEIGHT, fullscreen = true, leave = true } = {}) {
  const { layout, folded: foldedTeams } = hudFoldLayout(viewW, viewH, { collapsed, cardHeight });
  const top = topBarLayout(viewW, viewH, layout, { fullscreen });
  const boxes = [top.turn, top.quality];
  if (top.fullscreen) boxes.push(top.fullscreen);
  if (leave) boxes.push(top.leave);
  if (!layout.compact) {
    for (const [team, left] of [['x', true], ['o', false]]) {
      const folded = foldedTeams[team.toUpperCase()];
      const { w, h } = folded ? pillBox(layout.scale, viewW, viewH) : cardBox(layout.scale, cardHeight);
      const side = CARD_SIDE * layout.scale;
      boxes.push({ name: `${folded ? 'pill' : 'card'}-${team}`, x: left ? side : viewW - side - w, y: CARD_TOP, w, h });
    }
    return boxes;
  }
  if (layout.rail) {
    const h = layout.stacked ? RAIL_HEIGHT_STACKED : RAIL_HEIGHT_ROW;
    boxes.push({ name: 'card-x', x: COMPACT_EDGE, y: RAIL_TOP, w: layout.railWidth, h });
    boxes.push({ name: 'card-o', x: viewW - COMPACT_EDGE - layout.railWidth, y: RAIL_TOP, w: layout.railWidth, h });
    return boxes;
  }
  const w = viewW - 2 * COMPACT_EDGE;
  boxes.push({ name: 'card-x', x: COMPACT_EDGE, y: viewH - BARS_HEIGHT, w, h: BAR_HEIGHT });
  boxes.push({ name: 'card-o', x: COMPACT_EDGE, y: viewH - BAR_BOTTOM - BAR_HEIGHT, w, h: BAR_HEIGHT });
  return boxes;
}

// The spectator's watch card (docs/flow-design.md section 3.9, room.css
// .watch-card) stays up the whole game, so it goes where it never lies over
// the plots: beside the board under the left HUD card (full cards), in the
// left strip under the upright bar (rail), or between the board and the
// slim bars (compact; above the board under the top bar where that room
// is too short), at most CARD_WIDTH wide (the slim row spans the bars'
// width). Where the full card
// (cardHeight px tall at that width, measured by the DOM) does not fit it
// turns slim: one row, the title and Stop watching, WATCH_SLIM_HEIGHT px
// tall (10 px padding, the 44 px button, a 1 px border); the players and
// the phase stay readable on the HUD cards and turn pill. Returns
// { name, x, y, w, h, slim } in window pixels. Called when the window size
// changes, not per frame.
export const WATCH_SLIM_HEIGHT = 2 * 10 + 44 + 2;
export function watchCardBox(viewW, viewH, cardHeight, layout = hudLayout(viewW, viewH)) {
  const board = boardScreenRect(viewW, viewH);
  let x = HUD_GAP;
  let w = Math.min(CARD_WIDTH, board.left - 2 * HUD_GAP);
  let floor = viewH - HUD_GAP;
  let ceiling = CARD_TOP + cardBox(layout.scale).h + HUD_GAP;
  if (layout.rail) {
    x = COMPACT_EDGE;
    w = layout.railWidth;
    ceiling = RAIL_TOP + (layout.stacked ? RAIL_HEIGHT_STACKED : RAIL_HEIGHT_ROW) + HUD_GAP;
  } else if (layout.compact) {
    x = COMPACT_EDGE;
    w = Math.min(CARD_WIDTH, viewW - 2 * COMPACT_EDGE);
    floor = viewH - BARS_HEIGHT - HUD_GAP;
    ceiling = board.bottom + HUD_GAP;
  }
  let slim = floor - ceiling < cardHeight;
  if (layout.compact && !layout.rail) {
    // Where the room below the board is too short (a short phone, the bars
    // over the board) the card goes above the board, under the top bar.
    const top = topBarLayout(viewW, viewH, layout);
    const under = Math.max(...[top.turn, top.quality, top.fullscreen].filter(Boolean).map((b) => b.y + b.h)) + HUD_GAP;
    const above = board.top - HUD_GAP - under;
    const below = floor - ceiling;
    const fits = (h) => (below >= h ? 'below' : above >= h ? 'above' : null);
    const place = fits(cardHeight) ?? fits(WATCH_SLIM_HEIGHT) ?? 'below';
    slim = !(below >= cardHeight || (place === 'above' && above >= cardHeight));
    // The slim row spans the slim bars' width.
    if (slim) w = viewW - 2 * COMPACT_EDGE;
    const h = slim ? WATCH_SLIM_HEIGHT : cardHeight;
    const y = place === 'above' ? under : floor - h;
    return { name: 'watch-card', x, y, w: Math.floor(w), h, slim };
  }
  const h = slim ? WATCH_SLIM_HEIGHT : cardHeight;
  return { name: 'watch-card', x, y: floor - h, w: Math.floor(w), h, slim };
}
