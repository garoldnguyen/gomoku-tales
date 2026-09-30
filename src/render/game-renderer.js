// Canvas drawing for the game screen. Placeholder art only: a flat hill
// scene, a wooden grid, blue discs for X and red discs for O.

import { CELL_PX, INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config.js';
import { X, O } from '../logic/board.js';
import { BOARD_PX, BOARD_X, BOARD_Y, STATUS_Y, MESSAGE_Y, cellCenter, cellOrigin } from './layout.js';

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
};

const STONE_RADIUS = CELL_PX / 2 - 2;
const FRAME_PX = 6;

export function drawBackground(ctx) {
  ctx.fillStyle = COLORS.sky;
  ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
  const hillTop = Math.floor(INTERNAL_HEIGHT * 0.3);
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, hillTop, INTERNAL_WIDTH, INTERNAL_HEIGHT - hillTop);
  ctx.fillStyle = COLORS.grassDark;
  ctx.fillRect(0, hillTop, INTERNAL_WIDTH, 4);
}

function drawBoard(ctx, size) {
  ctx.fillStyle = COLORS.boardFrame;
  ctx.fillRect(BOARD_X - FRAME_PX, BOARD_Y - FRAME_PX, BOARD_PX + FRAME_PX * 2, BOARD_PX + FRAME_PX * 2);
  ctx.fillStyle = COLORS.board;
  ctx.fillRect(BOARD_X, BOARD_Y, BOARD_PX, BOARD_PX);

  ctx.fillStyle = COLORS.grid;
  for (let i = 0; i <= size; i++) {
    const offset = Math.min(i * CELL_PX, BOARD_PX - 1);
    ctx.fillRect(BOARD_X + offset, BOARD_Y, 1, BOARD_PX);
    ctx.fillRect(BOARD_X, BOARD_Y + offset, BOARD_PX, 1);
  }
}

export function drawStone(ctx, x, y, player, alpha = 1) {
  const { px, py } = cellCenter(x, y);
  drawDisc(ctx, px, py, player, alpha);
}

// Placeholder stone centred on a pixel position.
function drawDisc(ctx, px, py, player, alpha = 1) {
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

function drawCells(ctx, board) {
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      const cell = board[y][x];
      if (cell === X || cell === O) drawStone(ctx, x, y, cell);
    }
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

export function drawText(ctx, text, px, py, { color = COLORS.text, size = 18, align = 'center' } = {}) {
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.textShadow;
  ctx.fillText(text, px + 2, py + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, px, py);
}

// view: { state, hover, status, message, hint }
export function drawGameScreen(ctx, view) {
  const { state, hover, status, message, hint } = view;
  drawBackground(ctx);
  drawText(ctx, 'Gomoku Tales', INTERNAL_WIDTH / 2, 36, { size: 28 });
  if (hint) drawText(ctx, hint, INTERNAL_WIDTH / 2, 66, { size: 12 });

  drawBoard(ctx, state.board.length);
  drawCells(ctx, state.board);
  if (state.winLine) drawWinLine(ctx, state.winLine);
  if (hover) drawHover(ctx, hover, state.currentPlayer);

  // Status line: a small stone for the player to move (or the winner).
  const marker = state.winner ?? (state.draw ? null : state.currentPlayer);
  drawText(ctx, status, INTERNAL_WIDTH / 2 + (marker ? 14 : 0), STATUS_Y);
  if (marker) {
    const textWidth = ctx.measureText(status).width;
    drawDisc(ctx, INTERNAL_WIDTH / 2 - textWidth / 2, STATUS_Y, marker);
  }
  if (message) drawText(ctx, message, INTERNAL_WIDTH / 2, MESSAGE_Y, { color: COLORS.message, size: 14 });
}

export function drawTitleScreen(ctx, lines) {
  drawBackground(ctx);
  drawText(ctx, 'Gomoku Tales', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2 - 40, { size: 48 });
  lines.forEach((line, i) => {
    drawText(ctx, line, INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2 + 20 + i * 26, { size: 16 });
  });
}
