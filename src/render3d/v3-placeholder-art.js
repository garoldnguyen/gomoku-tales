// Generated stand-ins for the Farmland v3 art (docs/art-direction-v3.md
// section 2), drawn while a file in assets/3d/v3/ is missing or has the
// wrong size. They only need the right frame size and a readable shape and
// colour; the real files are the art. Each painter draws a whole sheet
// (all frames in one row) on a 2D context with fillRect only.
// Pure: no DOM or Three.js, so it runs under node --test.

const PLUM = '#2b1d3a';
const GRASS = '#58aa45';
const SOIL = '#8a5a3c';
const SOIL_DARK = '#6b4430';

// The board: 15 by 15 soil plots of `plot` px with grass gutters between.
export function farmBoardPainter({ size, cell, plot, low = false }) {
  return (ctx) => {
    ctx.fillStyle = low ? '#4a9a40' : GRASS;
    ctx.fillRect(0, 0, size, size);
    const inset = (cell - plot) / 2;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        ctx.fillStyle = SOIL;
        ctx.fillRect(x + inset, y + inset, plot, plot);
        ctx.fillStyle = SOIL_DARK; // two furrows
        ctx.fillRect(x + inset + 2, y + inset + plot / 3, plot - 4, 1 + (low ? 1 : 0));
        ctx.fillRect(x + inset + 2, y + inset + (plot * 2) / 3, plot - 4, 1 + (low ? 1 : 0));
      }
    }
  };
}

// Upright sprites: per frame an outlined block standing on the bottom
// centre, `colors[f]` (cycled) inside, so frames and looks tell apart.
// outline false leaves the plum outline off (clouds have none).
export function blockSheetPainter({ width, height, frames, colors, outline = true }) {
  return (ctx) => {
    for (let f = 0; f < frames; f++) {
      const w = Math.max(3, Math.round(width * 0.6));
      const h = Math.max(3, Math.round(height * (0.5 + (0.5 * (f + 1)) / frames)));
      const x = f * width + Math.floor((width - w) / 2);
      const y = height - h;
      if (outline) {
        ctx.fillStyle = PLUM;
        ctx.fillRect(x, y, w, h);
      }
      ctx.fillStyle = colors[f % colors.length];
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    }
  };
}

// Strips (curb, rail, path): a plain fill with a darker band, tiles cleanly.
export function stripPainter({ width, height, color, band }) {
  return (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = band;
    ctx.fillRect(0, height - 1, width, 1);
  };
}

// Flat marks on a plot: a frame `thick` px wide around the edge.
export function ringPainter({ size, color, thick = 2 }) {
  return (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(1, 1, size - 2, thick);
    ctx.fillRect(1, size - 1 - thick, size - 2, thick);
    ctx.fillRect(1, 1, thick, size - 2);
    ctx.fillRect(size - 1 - thick, 1, thick, size - 2);
  };
}
