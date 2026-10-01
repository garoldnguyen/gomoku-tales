// Placeholder pixel textures for the flat parts of the 3D world: the board
// top (480x480) and the cell decals (16x16 like the 2D placeholders) of the
// hover highlight, the board marks (world-renderer.js) and the skill
// visuals (effects3d.js). Each takes the 2D context of a canvas of the size
// listed in assets/manifest.json and draws into it; src/render3d/art.js
// uses them while the art file is missing. Only the context is used, so
// they run under node --test with a stand-in context.

import { BOARD_SIZE } from '../config.js';
import { seededRandom } from './seeded-random.js';

// A 2 px frame around the cell, with an optional fill inside.
export function drawFrame(ctx, color, fill) {
  const size = ctx.canvas.width;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, 2);
  ctx.fillRect(0, size - 2, size, 2);
  ctx.fillRect(0, 0, 2, size);
  ctx.fillRect(size - 2, 0, 2, size);
}

// Pale translucent wind over a Tornado Zone cell with a light edge.
export function drawZone(ctx) {
  const size = ctx.canvas.width;
  ctx.fillStyle = 'rgba(200, 236, 255, 0.45)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  for (let i = 0; i < size; i += 4) {
    // A dashed edge, so neighbouring zone cells read as one area.
    ctx.fillRect(i, 0, 2, 1);
    ctx.fillRect(i + 2, size - 1, 2, 1);
    ctx.fillRect(0, i + 2, 1, 2);
    ctx.fillRect(size - 1, i, 1, 2);
  }
}

// Three pale blue arcs around the cell centre, set pixel by pixel.
export function drawWhirl(ctx) {
  const size = ctx.canvas.width;
  const c = (size - 1) / 2;
  ctx.fillStyle = '#bfe8ff';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c);
      const angle = (Math.atan2(y - c, x - c) + Math.PI * 2) % ((Math.PI * 2) / 3);
      if (r >= 6 && r < 7.6 && angle < Math.PI / 2) ctx.fillRect(x, y, 1, 1);
    }
  }
}

// The red translucent frame on a Wind Dash target cell.
export function drawDashTarget(ctx) {
  drawFrame(ctx, '#ff2a3a', 'rgba(255, 42, 58, 0.28)');
}

// The gold frame of a cell in the winning line.
export function drawWinFrame(ctx) {
  drawFrame(ctx, '#ffe14d', 'rgba(255, 225, 77, 0.25)');
}

// The pale yellow frame of the stone chosen for a skill.
export function drawSelectFrame(ctx) {
  drawFrame(ctx, '#fff27a', null);
}

// Hover decal: a bright pixel frame around a soft warm fill.
export function drawHover(ctx) {
  const size = ctx.canvas.width;
  ctx.fillStyle = 'rgba(255, 240, 160, 0.35)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#fff6b0';
  ctx.fillRect(0, 0, size, 1);
  ctx.fillRect(0, size - 1, size, 1);
  ctx.fillRect(0, 0, 1, size);
  ctx.fillRect(size - 1, 0, 1, size);
}

// Pixel-art wooden board top: horizontal planks with grain, a dark grid
// line between cells and a darker outer border.
export function drawBoardTop(ctx) {
  const size = ctx.canvas.width;
  const cell = size / BOARD_SIZE;
  const plank = cell * 1.5;
  const random = seededRandom(7);

  for (let y = 0, i = 0; y < size; y += plank, i++) {
    ctx.fillStyle = i % 2 ? '#c48a52' : '#cf975c';
    ctx.fillRect(0, y, size, plank);
    ctx.fillStyle = '#a8713f';
    ctx.fillRect(0, y, size, 1);
    for (let n = 0; n < 40; n++) {
      ctx.fillStyle = random() < 0.6 ? '#b47b45' : '#dba86d';
      const gx = Math.floor(random() * size);
      const gy = y + 2 + Math.floor(random() * (plank - 4));
      ctx.fillRect(gx, gy, 4 + Math.floor(random() * 16), 1);
    }
  }

  ctx.fillStyle = '#6b3f1d';
  for (let i = 1; i < BOARD_SIZE; i++) {
    const p = Math.round(i * cell) - 1;
    ctx.fillRect(p, 0, 2, size);
    ctx.fillRect(0, p, size, 2);
  }
  ctx.fillStyle = '#4a2a14';
  ctx.fillRect(0, 0, size, 4);
  ctx.fillRect(0, size - 4, size, 4);
  ctx.fillRect(0, 0, 4, size);
  ctx.fillRect(size - 4, 0, 4, size);
}
