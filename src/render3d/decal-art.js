// Pixel textures for flat cell decals (16x16 like the 2D placeholders),
// shared by the board marks (world-renderer.js) and the skill visuals
// (effects3d.js). Each takes a 2D context of a decal canvas (world.js
// decalCanvas) and draws into it.

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
