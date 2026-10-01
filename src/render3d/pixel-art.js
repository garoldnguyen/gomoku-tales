// Tiny pure pixel painter for placeholder art. A grid is { width, height,
// pixels } where pixels holds one '#rrggbb' colour or null (transparent) per
// pixel, row by row. Shapes snap to whole pixels, so the art stays crisp.
// No DOM or Three.js, so it runs under node --test; src/render3d/sprites.js
// turns grids into canvases.

export function createGrid(width, height) {
  return { width, height, pixels: new Array(width * height).fill(null) };
}

export function getPixel(grid, x, y) {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  return grid.pixels[y * grid.width + x];
}

export function setPixel(grid, x, y, color) {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
  grid.pixels[y * grid.width + x] = color;
}

export function fillRect(grid, x, y, w, h, color) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) setPixel(grid, px, py, color);
  }
}

// Filled ellipse centred on pixel (cx, cy) with radii rx and ry in pixels.
export function fillEllipse(grid, cx, cy, rx, ry, color) {
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py++) {
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px++) {
      const dx = (px - cx) / (rx + 0.5);
      const dy = (py - cy) / (ry + 0.5);
      if (dx * dx + dy * dy < 1) setPixel(grid, px, py, color);
    }
  }
}

// Like fillEllipse, but only paints pixels that already hold a colour. Used
// for shading inside a shape without spilling over its edge.
export function shadeEllipse(grid, cx, cy, rx, ry, color) {
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py++) {
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px++) {
      const dx = (px - cx) / (rx + 0.5);
      const dy = (py - cy) / (ry + 0.5);
      if (dx * dx + dy * dy < 1 && getPixel(grid, px, py)) setPixel(grid, px, py, color);
    }
  }
}

// One pixel line from (x0, y0) to (x1, y1).
export function line(grid, x0, y0, x1, y1, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    setPixel(grid, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), color);
  }
}

// Paints `color` on every transparent pixel that touches a painted one
// (4-neighbours): the bold dark outline of docs/design.md.
export function outline(grid, color) {
  const edge = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (getPixel(grid, x, y)) continue;
      if (getPixel(grid, x - 1, y) || getPixel(grid, x + 1, y) || getPixel(grid, x, y - 1) || getPixel(grid, x, y + 1)) {
        edge.push(x, y);
      }
    }
  }
  for (let i = 0; i < edge.length; i += 2) setPixel(grid, edge[i], edge[i + 1], color);
}

// Grid from rows of characters, one character per pixel. `palette` maps a
// character to a colour; characters missing from it are transparent.
export function gridFromRows(rows, palette) {
  const grid = createGrid(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) setPixel(grid, x, y, palette[row[x]] ?? null);
  });
  return grid;
}

// Copies the painted pixels of `source` into `target` at (x, y).
export function blit(target, source, x = 0, y = 0) {
  for (let sy = 0; sy < source.height; sy++) {
    for (let sx = 0; sx < source.width; sx++) {
      const color = getPixel(source, sx, sy);
      if (color) setPixel(target, x + sx, y + sy, color);
    }
  }
}
