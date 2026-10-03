// Pure maths of the High screen grade (docs/art-direction-v3.md section 5):
// the warm colour grade and the light vignette, the same formulas as the
// grade pass in post-processing.js. No Three.js imports, so this runs under
// node --test.

import { VIGNETTE_DARKNESS, VIGNETTE_OFFSET, WARM_GRADE_GAIN, WARM_GRADE_SATURATION } from '../config.js';

const LUMA = [0.2126, 0.7152, 0.0722];

// The warm grade of a linear colour [r, g, b], written into `out`: a gain
// per channel, then saturation lifted around the colour's luminance.
export function warmGrade(rgb, out = [0, 0, 0], gain = WARM_GRADE_GAIN, saturation = WARM_GRADE_SATURATION) {
  let luma = 0;
  for (let i = 0; i < 3; i++) {
    out[i] = rgb[i] * gain[i];
    luma += out[i] * LUMA[i];
  }
  for (let i = 0; i < 3; i++) out[i] = Math.max(0, luma + (out[i] - luma) * saturation);
  return out;
}

// How far (0 to 1) the vignette darkens the pixel at screen uv (u, v),
// each 0 to 1: 0 in the centre, growing toward the corners, as three.js's
// VignetteShader does.
export function vignetteMix(u, v, offset = VIGNETTE_OFFSET, darkness = VIGNETTE_DARKNESS) {
  const x = (u - 0.5) * offset;
  const y = (v - 0.5) * offset;
  return (x * x + y * y) * Math.min(Math.max(darkness, 0), 1);
}
