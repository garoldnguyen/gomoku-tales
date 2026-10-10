// The stone grey of a petrified plant (Earth Bear's Petrification): every
// pixel of a plant sheet keeps its brightness but loses its colour, mapped
// onto a cool grey ramp, so the plant that is drawn grey before it shatters
// is the same plant with its colour drained. The outline stays dark and the
// blooms turn pale stone. Pure: it works on RGBA bytes, so it runs under
// node --test; mark-tints.js applies it to the plant canvases.

export const STONE_DARK = Object.freeze([52, 54, 68]); // what black becomes
export const STONE_LIGHT = Object.freeze([214, 216, 226]); // what white becomes

// A copy of RGBA `pixels` in stone grey. Alpha is kept as it is; a see-
// through pixel stays see-through.
export function stonePixels(pixels) {
  const out = new pixels.constructor(pixels.length);
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha === 0) continue;
    const light = (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) / 255;
    out[i] = Math.round(STONE_DARK[0] + (STONE_LIGHT[0] - STONE_DARK[0]) * light);
    out[i + 1] = Math.round(STONE_DARK[1] + (STONE_LIGHT[1] - STONE_DARK[1]) * light);
    out[i + 2] = Math.round(STONE_DARK[2] + (STONE_LIGHT[2] - STONE_DARK[2]) * light);
    out[i + 3] = alpha;
  }
  return out;
}
