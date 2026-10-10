// Canvas drawing for the game screen. Every sprite comes from the asset
// store (see assets.js and assets/manifest.json); while its file is missing a
// placeholder is drawn instead: a flat hill scene, a wooden grid, blue discs
// for X, red discs for O, grey squares for rocks, wooden panel frames and
// lettered skill icons.

import { CELL_PX, INTERNAL_WIDTH, INTERNAL_HEIGHT, ROCK_PX, STONE_PX, TORNADO_PX } from '../config.js';
import { X, O, ROCK } from '../logic/board.js';
import { WIND_DASH, TORNADO_ZONE, MUD_TRAP, PETRIFICATION } from '../logic/skills.js';
import {
  BOARD_FRAME_PX, BOARD_PX, BOARD_X, BOARD_Y, HUD_2D, PORTRAIT_PX, SKILL_ICON_PX,
  cellCenter, cellOrigin, panelRect, skillButtonRect,
} from './layout.js';
import { createAssetStore } from './assets.js';
import { drawWindStreaks } from './effects.js';
import { canvasFont } from './canvas-font.js';

// Manifest names of the sprites drawn here.
export const SPRITES = {
  background: 'background',
  board: 'board',
  panel: { [X]: 'panel-wind-rabbit', [O]: 'panel-earth-bear' },
  portrait: { [X]: 'portrait-wind-rabbit', [O]: 'portrait-earth-bear' },
  stone: { [X]: 'stone-x', [O]: 'stone-o' },
  rock: 'rock',
  tornado: 'tornado',
  icon: {
    [WIND_DASH]: 'icon-wind-dash',
    [TORNADO_ZONE]: 'icon-tornado-zone',
    // Mud Trap and Petrification have no 32 px file: the 2D canvas HUD
    // draws their lettered placeholders (the glass HUD has the 128 px art).
  },
};

// Starts empty (all placeholders); main.js swaps in the loaded store.
let assets = createAssetStore();

export function setAssets(store) {
  assets = store;
}

const COLORS = {
  sky: '#8fd3ff',
  grass: '#5cc85a',
  grassDark: '#3f9e45',
  boardFrame: '#7a4a22',
  board: '#d9a066',
  grid: '#8a5a2b',
  outline: '#1a1020',
  stoneX: '#3b8cff',
  stoneO: '#ff4b5c',
  shine: 'rgba(255, 255, 255, 0.55)',
  hover: 'rgba(255, 255, 255, 0.35)',
  winLine: '#ffe14d',
  text: '#ffffff',
  textShadow: '#1a1020',
  message: '#ffd6d6',
  rock: '#9a9aa6',
  rockDark: '#5e5e6c',
  rockLight: '#c8c8d2',
  mud: 'rgba(107, 74, 43, 0.85)',
  mudEdge: '#523720',
  sunk: 'rgba(82, 55, 32, 0.6)',
  dashFrame: '#ff2a3a',
  dashFill: 'rgba(255, 42, 58, 0.28)',
  whirl: '#bfe8ff',
  tornadoFill: 'rgba(200, 236, 255, 0.38)',
  tornadoEdge: 'rgba(255, 255, 255, 0.85)',
  select: '#fff27a',
  panelFrame: '#5a3418',
  panelWood: '#a8703c',
  panelGrain: '#946030',
  panelInner: '#c48a50',
  panelActive: '#ffe14d',
  button: '#e8c08a',
  buttonHover: '#f6d8a8',
  buttonSelected: '#fff27a',
  buttonText: '#3a2410',
  locked: 'rgba(60, 60, 70, 0.6)',
  youTag: '#3fbf5a',
  portraitX: '#e8f4ff',
  portraitO: '#b07848',
};

const STONE_RADIUS = CELL_PX / 2 - 2;
const FRAME_PX = BOARD_FRAME_PX;

// Placeholder icon letters and colours per skill.
const SKILL_ICONS = {
  [WIND_DASH]: { letters: 'WD', color: '#7cc4ff' },
  [TORNADO_ZONE]: { letters: 'TZ', color: '#9fe0e8' },
  [MUD_TRAP]: { letters: 'MT', color: '#c49a6c' },
  [PETRIFICATION]: { letters: 'PE', color: '#b8b8c4' },
};

// The Map 1 scene with the wind streaks drifting over it at all times.
export function drawBackground(ctx, time = performance.now()) {
  assets.draw(ctx, SPRITES.background, 0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT, () => {
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
    const hillTop = Math.floor(INTERNAL_HEIGHT * 0.3);
    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, hillTop, INTERNAL_WIDTH, INTERNAL_HEIGHT - hillTop);
    ctx.fillStyle = COLORS.grassDark;
    ctx.fillRect(0, hillTop, INTERNAL_WIDTH, 4);
  });
  drawWindStreaks(ctx, time);
}

// The board sprite covers the frame and the grid: its cells must line up
// with CELL_PX starting FRAME_PX in from the top-left corner.
function drawBoard(ctx, size) {
  const framed = BOARD_PX + FRAME_PX * 2;
  assets.draw(ctx, SPRITES.board, BOARD_X - FRAME_PX, BOARD_Y - FRAME_PX, framed, framed, () => {
    ctx.fillStyle = COLORS.boardFrame;
    ctx.fillRect(BOARD_X - FRAME_PX, BOARD_Y - FRAME_PX, framed, framed);
    ctx.fillStyle = COLORS.board;
    ctx.fillRect(BOARD_X, BOARD_Y, BOARD_PX, BOARD_PX);

    ctx.fillStyle = COLORS.grid;
    for (let i = 0; i <= size; i++) {
      const offset = Math.min(i * CELL_PX, BOARD_PX - 1);
      ctx.fillRect(BOARD_X + offset, BOARD_Y, 1, BOARD_PX);
      ctx.fillRect(BOARD_X, BOARD_Y + offset, BOARD_PX, 1);
    }
  });
}

export function drawStone(ctx, x, y, player, alpha = 1) {
  const { px, py } = cellCenter(x, y);
  drawDisc(ctx, px, py, player, alpha);
}

// Stone sprite centred on a pixel position.
function drawDisc(ctx, px, py, player, alpha = 1) {
  const half = STONE_PX / 2;
  assets.draw(ctx, SPRITES.stone[player], px - half, py - half, STONE_PX, STONE_PX,
    () => drawPlaceholderDisc(ctx, px, py, player, alpha), { alpha });
}

// Placeholder stone: a blue (X) or red (O) disc with an outline.
function drawPlaceholderDisc(ctx, px, py, player, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(px, py, STONE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = player === X ? COLORS.stoneX : COLORS.stoneO;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.outline;
  ctx.stroke();
  ctx.fillStyle = COLORS.shine;
  ctx.fillRect(px - 5, py - 6, 4, 3);
  ctx.restore();
}

function drawRock(ctx, x, y, alpha = 1) {
  const { px, py } = cellCenter(x, y);
  const half = ROCK_PX / 2;
  assets.draw(ctx, SPRITES.rock, px - half, py - half, ROCK_PX, ROCK_PX,
    () => drawPlaceholderRock(ctx, x, y, alpha), { alpha });
}

// Placeholder rock: a grey square with an outline.
function drawPlaceholderRock(ctx, x, y, alpha) {
  const { px, py } = cellOrigin(x, y);
  const inset = 3;
  const size = CELL_PX - inset * 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.outline;
  ctx.fillRect(px + inset, py + inset, size, size);
  ctx.fillStyle = COLORS.rock;
  ctx.fillRect(px + inset + 2, py + inset + 2, size - 4, size - 4);
  ctx.fillStyle = COLORS.rockLight;
  ctx.fillRect(px + inset + 3, py + inset + 3, 5, 3);
  ctx.fillStyle = COLORS.rockDark;
  ctx.fillRect(px + inset + 2, py + inset + size - 5, size - 4, 3);
  ctx.restore();
}

// A plain brown tint over a cell: a mud puddle, or a seed sunk in mud (the
// stone is drawn first, so the tint dims it).
function drawMudTint(ctx, x, y, color) {
  const { px, py } = cellOrigin(x, y);
  ctx.fillStyle = color;
  ctx.fillRect(px + 1, py + 1, CELL_PX - 1, CELL_PX - 1);
}

function drawCells(ctx, state) {
  const { board } = state;
  for (const { x, y } of state.mud ?? []) {
    drawMudTint(ctx, x, y, COLORS.mud);
    const { px, py } = cellOrigin(x, y);
    ctx.strokeStyle = COLORS.mudEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 2, py + 2, CELL_PX - 3, CELL_PX - 3);
  }
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      const cell = board[y][x];
      if (cell === X || cell === O) drawStone(ctx, x, y, cell);
      else if (cell === ROCK) drawRock(ctx, x, y);
    }
  }
  for (const { x, y } of state.sunk ?? []) drawMudTint(ctx, x, y, COLORS.sunk);
}

// Translucent overlay over a group of cells (the Tornado Zone), drawn as
// their bounding box because the zone is always a clipped square. The
// animated tornado sprite is centred on the box and clipped to it.
function drawZone(ctx, cells, time, alpha = 1) {
  if (cells.length === 0) return;
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const { px, py } = cellOrigin(Math.min(...xs), Math.min(...ys));
  const w = (Math.max(...xs) - Math.min(...xs) + 1) * CELL_PX;
  const h = (Math.max(...ys) - Math.min(...ys) + 1) * CELL_PX;
  const cx = px + w / 2;
  const cy = py + h / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.rect(px, py, w, h);
  ctx.clip();
  assets.draw(ctx, SPRITES.tornado, cx - TORNADO_PX / 2, cy - TORNADO_PX / 2, TORNADO_PX, TORNADO_PX, () => {
    ctx.fillStyle = COLORS.tornadoFill;
    ctx.fillRect(px, py, w, h);
    // A few swirl arcs so it reads as wind.
    ctx.strokeStyle = COLORS.whirl;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const r = 6 + i * 8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, i * 2.1, i * 2.1 + Math.PI * 1.2);
      ctx.stroke();
    }
  }, { time });
  // Dashed edge so the zone reads clearly with or without art.
  ctx.strokeStyle = COLORS.tornadoEdge;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(px + 1, py + 1, w - 2, h - 2);
  ctx.setLineDash([]);
  ctx.restore();
}

// Red translucent frame on a Wind Dash target cell.
function drawDashTarget(ctx, x, y, alpha = 1) {
  const { px, py } = cellOrigin(x, y);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.dashFill;
  ctx.fillRect(px + 1, py + 1, CELL_PX - 1, CELL_PX - 1);
  ctx.strokeStyle = COLORS.dashFrame;
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 2, py + 2, CELL_PX - 3, CELL_PX - 3);
  ctx.restore();
}

// Pale blue whirl around a Wind Dash source stone.
function drawWhirl(ctx, x, y) {
  const { px, py } = cellCenter(x, y);
  ctx.save();
  ctx.strokeStyle = COLORS.whirl;
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(px, py, STONE_RADIUS + 2, i * (Math.PI * 2 / 3), i * (Math.PI * 2 / 3) + Math.PI / 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelectRing(ctx, x, y) {
  const { px, py } = cellOrigin(x, y);
  ctx.strokeStyle = COLORS.select;
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, CELL_PX - 2, CELL_PX - 2);
}

// Announced skills that are still waiting: the Tornado Zone and a pending
// Wind Dash.
function drawAnnouncements(ctx, state, time) {
  if (state.tornado?.cells) drawZone(ctx, state.tornado.cells, time); // a hidden zone has no cells
  if (state.pendingDash) {
    drawDashTarget(ctx, state.pendingDash.to.x, state.pendingDash.to.y);
    drawWhirl(ctx, state.pendingDash.from.x, state.pendingDash.from.y);
  }
}

// Hover preview for the skill target flow (see ui/targeting.js).
function drawPreview(ctx, preview, time) {
  switch (preview.type) {
    case 'select':
      drawSelectRing(ctx, preview.x, preview.y);
      break;
    case 'dash':
      drawSelectRing(ctx, preview.from.x, preview.from.y);
      drawWhirl(ctx, preview.from.x, preview.from.y);
      if (preview.to) drawDashTarget(ctx, preview.to.x, preview.to.y, 0.7);
      break;
    case 'zone':
      drawZone(ctx, preview.cells, time, 0.6);
      break;
  }
}

function drawHover(ctx, hover, player) {
  const { px, py } = cellOrigin(hover.x, hover.y);
  ctx.fillStyle = COLORS.hover;
  ctx.fillRect(px + 1, py + 1, CELL_PX - 1, CELL_PX - 1);
  drawStone(ctx, hover.x, hover.y, player, 0.45);
}

function drawWinLine(ctx, winLine) {
  ctx.strokeStyle = COLORS.winLine;
  ctx.lineWidth = 2;
  for (const { x, y } of winLine) {
    const { px, py } = cellOrigin(x, y);
    ctx.strokeRect(px + 1, py + 1, CELL_PX - 2, CELL_PX - 2);
  }
}

// The font string of each size is built once, so drawing text every frame
// (the 3D render loop) allocates none.
const NO_STYLE = Object.freeze({});
const fonts = new Map(); // size -> font string
function newFont(size) {
  const font = canvasFont(size);
  fonts.set(size, font);
  return font;
}
export function drawText(ctx, text, px, py, { color = COLORS.text, size = 18, align = 'center' } = NO_STYLE) {
  ctx.font = fonts.get(size) ?? newFont(size);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.textShadow;
  ctx.fillText(text, px + 2, py + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, px, py);
}

// Signboard behind a player's panel, with a highlight on that player's turn.
function drawWoodFrame(ctx, { x, y, w, h }, player, active) {
  if (active) {
    ctx.fillStyle = COLORS.panelActive;
    ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  }
  assets.draw(ctx, SPRITES.panel[player], x, y, w, h, () => drawPlaceholderWood(ctx, { x, y, w, h }));
}

// Old wooden signboard placeholder: a dark frame, planks and grain lines.
function drawPlaceholderWood(ctx, { x, y, w, h }) {
  ctx.fillStyle = COLORS.panelFrame;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COLORS.panelWood;
  ctx.fillRect(x + 5, y + 5, w - 10, h - 10);
  ctx.fillStyle = COLORS.panelGrain;
  for (let gy = y + 22; gy < y + h - 10; gy += 28) ctx.fillRect(x + 5, gy, w - 10, 2);
  // Nail heads in the corners.
  ctx.fillStyle = COLORS.panelFrame;
  for (const [nx, ny] of [[x + 9, y + 9], [x + w - 13, y + 9], [x + 9, y + h - 13], [x + w - 13, y + h - 13]]) {
    ctx.fillRect(nx, ny, 4, 4);
  }
}

// Framed portrait. Placeholder: a square with the character's initial.
function drawPortrait(ctx, px, py, panel) {
  ctx.fillStyle = COLORS.outline;
  ctx.fillRect(px - 2, py - 2, PORTRAIT_PX + 4, PORTRAIT_PX + 4);
  assets.draw(ctx, SPRITES.portrait[panel.player], px, py, PORTRAIT_PX, PORTRAIT_PX, () => {
    ctx.fillStyle = panel.player === X ? COLORS.portraitX : COLORS.portraitO;
    ctx.fillRect(px, py, PORTRAIT_PX, PORTRAIT_PX);
    ctx.fillStyle = panel.player === X ? COLORS.stoneX : COLORS.stoneO;
    ctx.fillRect(px, py + PORTRAIT_PX - 12, PORTRAIT_PX, 12);
    drawText(ctx, panel.name[0], px + PORTRAIT_PX / 2, py + PORTRAIT_PX / 2 - 4, { size: 48, color: COLORS.buttonText });
  });
}

// Framed skill icon. Placeholder: a coloured square with two letters.
function drawSkillIcon(ctx, px, py, skillId) {
  ctx.fillStyle = COLORS.outline;
  ctx.fillRect(px - 1, py - 1, SKILL_ICON_PX + 2, SKILL_ICON_PX + 2);
  assets.draw(ctx, SPRITES.icon[skillId], px, py, SKILL_ICON_PX, SKILL_ICON_PX, () => {
    const icon = SKILL_ICONS[skillId] ?? { letters: '?', color: COLORS.button };
    ctx.fillStyle = icon.color;
    ctx.fillRect(px, py, SKILL_ICON_PX, SKILL_ICON_PX);
    drawText(ctx, icon.letters, px + SKILL_ICON_PX / 2, py + SKILL_ICON_PX / 2, { size: 13 });
  });
}

const SKILL_NAME_FONT = canvasFont(13);
const SKILL_STATE_FONT = canvasFont(11);

function drawSkillButton(ctx, rect, skill, panelActive) {
  const { x, y, w, h } = rect;
  ctx.fillStyle = skill.selected ? COLORS.buttonSelected : COLORS.outline;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = skill.hovered && skill.usable ? COLORS.buttonHover : COLORS.button;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  if (skill.selected) {
    ctx.strokeStyle = COLORS.buttonSelected;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
  }

  const iconX = x + 10;
  const iconY = y + (h - SKILL_ICON_PX) / 2;
  drawSkillIcon(ctx, iconX, iconY, skill.id);
  const textX = iconX + SKILL_ICON_PX + 10;
  ctx.font = SKILL_NAME_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.buttonText;
  ctx.fillText(skill.name, textX, y + 22);
  ctx.font = SKILL_STATE_FONT;
  const turns = skill.cooldown === 1 ? 'turn' : 'turns';
  ctx.fillText(skill.locked ? `Locked: ${skill.cooldown} ${turns}` : skill.selected ? 'Choosing...' : skill.note ?? 'Ready', textX, y + 42);

  if (skill.locked) {
    // Grey overlay with the remaining cooldown over the icon.
    ctx.fillStyle = COLORS.locked;
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    drawText(ctx, String(skill.cooldown), iconX + SKILL_ICON_PX / 2, iconY + SKILL_ICON_PX / 2, { size: 22 });
  } else if (!panelActive || skill.note) {
    // Not this player's turn, or a skill was already used this turn (the
    // note says so): dimmed but not locked.
    ctx.fillStyle = 'rgba(40, 30, 20, 0.25)';
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  }
}

// view panel: see panelView in ui/local-game.js. layout: a HUD layout
// from layout.js.
function drawPanel(ctx, panel, layout) {
  const rect = panelRect(panel.player, layout);
  drawWoodFrame(ctx, rect, panel.player, panel.active);
  const cx = rect.x + rect.w / 2;
  if (layout.portraitY !== null) drawPortrait(ctx, cx - PORTRAIT_PX / 2, rect.y + layout.portraitY, panel);
  drawText(ctx, panel.name, cx, rect.y + layout.nameY, { size: layout.nameSize });

  const stoneText = `Stone: ${panel.stone}`;
  drawText(ctx, stoneText, cx + 12, rect.y + layout.stoneLineY, { size: 13 });
  const textWidth = ctx.measureText(stoneText).width;
  drawDisc(ctx, cx + 12 - textWidth / 2 - 16, rect.y + layout.stoneLineY, panel.player);

  if (panel.you) {
    ctx.fillStyle = COLORS.outline;
    ctx.fillRect(rect.x + 10, rect.y + 10, 40, 20);
    ctx.fillStyle = COLORS.youTag;
    ctx.fillRect(rect.x + 12, rect.y + 12, 36, 16);
    drawText(ctx, 'You', rect.x + 30, rect.y + 20, { size: 11 });
  }

  panel.skills.forEach((skill, index) => drawSkillButton(ctx, skillButtonRect(panel.player, index, layout), skill, panel.active));

  const lastButton = skillButtonRect(panel.player, panel.skills.length - 1, layout);
  const footerY = (lastButton.y + lastButton.h + rect.y + rect.h) / 2;
  if (panel.winner) drawText(ctx, 'WINNER!', cx, footerY, { size: 18, color: COLORS.panelActive });
  else if (panel.active) drawText(ctx, 'Taking a turn', cx, footerY, { size: 13, color: COLORS.panelActive });
}

// Title, hint line and the player panels.
function drawHeaderAndPanels(ctx, view, layout) {
  const { panels = [], hint } = view;
  drawText(ctx, 'Gomoku Tales', INTERNAL_WIDTH / 2, 36, { size: 28 });
  if (hint) drawText(ctx, hint, INTERNAL_WIDTH / 2, 66, { size: 12 });
  for (const panel of panels) drawPanel(ctx, panel, layout);
}

// Status line: a small stone for the player to move (or the winner).
// view.marker, when given, overrides it (null for none). Then the message.
function drawStatusLines(ctx, view, layout) {
  const { state, status, message } = view;
  const marker = view.marker !== undefined ? view.marker : state.winner ?? (state.draw ? null : state.currentPlayer);
  drawText(ctx, status, INTERNAL_WIDTH / 2 + (marker ? 14 : 0), layout.statusY);
  if (marker) {
    const textWidth = ctx.measureText(status).width;
    drawDisc(ctx, INTERNAL_WIDTH / 2 - textWidth / 2, layout.statusY, marker);
  }
  if (message) drawText(ctx, message, INTERNAL_WIDTH / 2, layout.messageY, { color: COLORS.message, size: 14 });
}

// view: { state, hover, preview, panels, status, message, hint, marker?, time?, effects? }
// time (ms) drives animated sprites and defaults to the page clock.
// effects (see effects.js), when given, adds the screen shake, particles
// and banners.
export function drawGameScreen(ctx, view) {
  const { state, hover, preview, effects } = view;
  const time = view.time ?? performance.now();
  drawBackground(ctx, time);

  // The light screen shake moves everything in front of the scene.
  const shake = effects ? effects.shake(time) : { dx: 0, dy: 0 };
  ctx.save();
  ctx.translate(shake.dx, shake.dy);
  drawHeaderAndPanels(ctx, view, HUD_2D);

  drawBoard(ctx, state.board.length);
  drawCells(ctx, state);
  drawAnnouncements(ctx, state, time);
  if (state.winLine) drawWinLine(ctx, state.winLine);
  if (hover) drawHover(ctx, hover, state.currentPlayer);
  if (preview) drawPreview(ctx, preview, time);

  drawStatusLines(ctx, view, HUD_2D);
  if (effects) effects.drawParticles(ctx, time);
  ctx.restore();

  if (effects) effects.drawBanner(ctx, time);
}

// Background and title behind the lobby and room screens (DOM overlays).
export function drawMenuScreen(ctx, time = performance.now(), title = true) {
  drawBackground(ctx, time);
  if (title) drawText(ctx, 'Gomoku Tales', INTERNAL_WIDTH / 2, 90, { size: 48 });
}
