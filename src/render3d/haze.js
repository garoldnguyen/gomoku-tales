// Horizon haze (docs/art-direction-v3-1.md section 5): far things lose
// colour into ONE haze colour through the functions here, so every layer
// fades the same way. No blur is used for any of it. Every number of the
// section lives in one named constant below, shared by the scene code
// (sky-scene.js, ridges-scene.js, meadow-scene.js) and the tests. Pure: no
// Three.js imports, so it runs under node --test.
//
// Depths are measured at the 16:9 reference view as a percent of the screen
// height below the projected far edge, converted once to world z with the
// real camera (groundZAtScreenY) and kept as world values for every window
// shape, so the forest (part 4) stays put in the world.

import { gameCamera } from './camera.js';
import { fitView, GAME_ASPECT, zoomK } from './framing.js';
import { FAR_EDGE_Z, groundUnderNdc, screenPercent } from './horizon.js';

// --- 5.1 Colours ---

// The colour far things fade into, and the sky's colour at the horizon.
export const HAZE_COLOR = '#eaf2e4';
// The sky gradient from the top of the window (0) down to the horizon (1),
// the projected far edge. Plain, no dithering, the same on every level.
export const SKY_HAZE_STOPS = Object.freeze([
  Object.freeze([0, '#4a90e2']),
  Object.freeze([0.45, '#7fbdf0']),
  Object.freeze([0.8, '#c9e2ec']),
  Object.freeze([1, HAZE_COLOR]),
]);
// The ground mixes toward this at the far edge (5.4).
export const GROUND_FOG_COLOR = '#badca8';
// The ground between the forest trunks mixes toward this on High (5.5).
export const FLOOR_SHADE_COLOR = '#144628';

// --- 5.2 Depth reference ---

// Percent of the screen height below the far edge at the 16:9 reference.
export const HAZE_DEPTH_PERCENT = Object.freeze({
  wallBase: 0.55, // the far canopy wall's base
  row1: 0.65, // tree row 1 (back)
  row2: 2.1, // tree row 2
  row3: 3.6, // tree row 3 (front)
  fogEnd: 6.9, // the soft ground edge ends
  floorShadeIn: 0.9, // the forest floor shade is fully in
  floorShadeOut: 3.0, // and starts to fade out
  floorShadeEnd: 5.7, // and is gone
  forestZone: 7.2, // meadow props stay in front of this line (section 6.7)
});

const REFERENCE_CAMERA = gameCamera(GAME_ASPECT);

// The screen fraction from the top at which the far edge shows in a window
// `aspect` wide: the projected far edge, the horizon. The camera widens
// below 16:9 (fitView), so the horizon sits lower on narrow windows.
export function horizonScreenFraction(aspect = GAME_ASPECT) {
  return screenPercent({ x: 0, y: 0, z: FAR_EDGE_Z }, gameCamera(aspect), aspect).y / 100;
}

// The world z of the ground `percentBelow` percent of the screen height
// below the projected far edge at the 16:9 reference view, with the real
// camera.
export function groundZAtScreenY(percentBelow) {
  const fraction = horizonScreenFraction(GAME_ASPECT) + percentBelow / 100;
  return groundUnderNdc(REFERENCE_CAMERA, 0, 1 - 2 * fraction).z;
}

// The world depths of section 5.2, worked out once.
export const WALL_BASE_Z = groundZAtScreenY(HAZE_DEPTH_PERCENT.wallBase);
export const FOREST_ROW_Z = Object.freeze([
  groundZAtScreenY(HAZE_DEPTH_PERCENT.row1),
  groundZAtScreenY(HAZE_DEPTH_PERCENT.row2),
  groundZAtScreenY(HAZE_DEPTH_PERCENT.row3),
]);
export const GROUND_FOG_END_Z = groundZAtScreenY(HAZE_DEPTH_PERCENT.fogEnd);
export const FLOOR_SHADE_Z = Object.freeze({
  in: groundZAtScreenY(HAZE_DEPTH_PERCENT.floorShadeIn),
  out: groundZAtScreenY(HAZE_DEPTH_PERCENT.floorShadeOut),
  end: groundZAtScreenY(HAZE_DEPTH_PERCENT.floorShadeEnd),
});
export const FOREST_ZONE_Z = groundZAtScreenY(HAZE_DEPTH_PERCENT.forestZone);

// GLSL smoothstep: 0 at edge0, 1 at edge1, smooth between.
export function smoothBetween(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

// --- 5.3 Haze of things standing in the forest ---

// [world z, haze] from far to near: the wall base, rows 1, 2 and 3.
export const HAZE_NODES = Object.freeze([
  Object.freeze([WALL_BASE_Z, 0.42]),
  Object.freeze([FOREST_ROW_Z[0], 0.30]),
  Object.freeze([FOREST_ROW_Z[1], 0.14]),
  Object.freeze([FOREST_ROW_Z[2], 0.0]),
]);

// How much of HAZE_COLOR a thing whose base stands at world depth `z` takes:
// linear between the nodes, 0.42 behind the wall base, 0 in front of row 3.
// Output colour is mix(spriteColour, HAZE_COLOR, amount), alpha untouched.
export function hazeAmount(z) {
  const first = HAZE_NODES[0];
  const last = HAZE_NODES[HAZE_NODES.length - 1];
  if (!(z > first[0])) return first[1];
  if (z >= last[0]) return last[1];
  for (let i = 1; i < HAZE_NODES.length; i++) {
    const [z1, h1] = HAZE_NODES[i];
    if (z <= z1) {
      const [z0, h0] = HAZE_NODES[i - 1];
      return h0 + ((h1 - h0) * (z - z0)) / (z1 - z0);
    }
  }
  return last[1];
}

// The far canopy wall's top fade: `v` is the position inside the strip from
// its top (0) to its base (1). The tops of the far trees melt into the sky.
export const WALL_TOP_HAZE = 0.28;
export function wallTopHaze(v) {
  return WALL_TOP_HAZE * (1 - smoothBetween(0, 1, v));
}

// --- 5.4 Soft ground edge (all levels) ---

export const GROUND_FOG_MAX = 0.55;
// How far the ground at world depth `z` mixes toward GROUND_FOG_COLOR:
// GROUND_FOG_MAX at the far edge, 0 from GROUND_FOG_END_Z on.
export function groundFogAmount(z) {
  return GROUND_FOG_MAX * (1 - smoothBetween(FAR_EDGE_Z, GROUND_FOG_END_Z, z));
}

// The ground's far edge also feathers its alpha over this much (percent of
// the screen height below the far edge at the 16:9 reference), so the
// meadow melts into what stands behind it (the haze of the sky on Low, the
// near ridge on Medium and High) instead of ending in a hard line. Not a
// number of section 5: the fog alone cannot reach the sky's colour, and the
// task puts "no hard line between meadow and sky" before section 5's numbers.
export const GROUND_EDGE_FEATHER_PERCENT = 3;
export const GROUND_EDGE_FEATHER_Z = groundZAtScreenY(GROUND_EDGE_FEATHER_PERCENT) - FAR_EDGE_Z;
// The ground's alpha `depthInFront` world units in front of its far edge.
export function groundEdgeAlpha(depthInFront) {
  return smoothBetween(0, GROUND_EDGE_FEATHER_Z, depthInFront);
}

// --- 5.5 Forest floor shade (High) ---

export const FLOOR_SHADE_MAX = 0.20;
// How far the ground at world depth `z` mixes toward FLOOR_SHADE_COLOR: in
// over the first 0.9 percent behind the far edge, out between 3.0 and 5.7.
export function floorShadeAmount(z) {
  return FLOOR_SHADE_MAX * smoothBetween(FAR_EDGE_Z, FLOOR_SHADE_Z.in, z) * (1 - smoothBetween(FLOOR_SHADE_Z.out, FLOOR_SHADE_Z.end, z));
}

// --- 5.6 Ridges (Medium and High) ---

// Ridges are measured in virtual pixels: a screen this tall.
export const RIDGE_VIRTUAL_HEIGHT = 1080;
// Each crest is `base - sum(amplitude * sin(x / period + phase))` virtual
// px above the horizon at virtual x; the alpha rises from 0 at the crest to
// 1 over `featherPx` (a smoothstep); `haze` is the haze at its base.
export const RIDGES = Object.freeze([
  Object.freeze({ name: 'far', color: '#96cc9c', base: 93, waves: Object.freeze([[16, 330, 1.1], [8, 140, 0.4]]), featherPx: 40, haze: 0.55 }),
  Object.freeze({ name: 'near', color: '#7abe80', base: 63, waves: Object.freeze([[11, 230, 2.3], [6, 95, 1.7]]), featherPx: 30, haze: 0.38 }),
]);
// The haze adds this much more at the crest, fading out over RIDGE_FADE_PX.
export const RIDGE_CREST_HAZE = 0.30;
export const RIDGE_FADE_PX = 90;

// Height of `ridge`'s crest above the horizon at virtual x, in virtual px.
export function ridgeCrest(ridge, x) {
  let height = ridge.base;
  for (const [amplitude, period, phase] of ridge.waves) height -= amplitude * Math.sin(x / period + phase);
  return height;
}
export function farRidgeCrest(x) {
  return ridgeCrest(RIDGES[0], x);
}
export function nearRidgeCrest(x) {
  return ridgeCrest(RIDGES[1], x);
}

// The crest's height above the horizon in screen pixels at screen x `xPx`
// on a screen `screenHeight` px tall, at `zoom` (zoomK of the view).
export function ridgeHeightPx(ridge, xPx, screenHeight, zoom = 1) {
  const unit = screenHeight / RIDGE_VIRTUAL_HEIGHT;
  return zoom * unit * ridgeCrest(ridge, xPx / unit);
}

// The crest of `ridge` at screen fraction `fx` from the left, as a fraction
// of the screen height from the top, in a window `aspect` wide.
export function ridgeCrestScreenFraction(ridge, fx, aspect = GAME_ASPECT) {
  const zoom = zoomK(fitView(aspect));
  const xVirtual = fx * aspect * RIDGE_VIRTUAL_HEIGHT;
  return horizonScreenFraction(aspect) - (zoom * ridgeCrest(ridge, xVirtual)) / RIDGE_VIRTUAL_HEIGHT;
}

// Alpha of `ridge` `depthBelowCrest` virtual px below its crest.
export function ridgeAlpha(ridge, depthBelowCrest) {
  return smoothBetween(0, ridge.featherPx, depthBelowCrest);
}

// Haze of `ridge` `depthBelowCrest` virtual px below its crest.
export function ridgeHaze(ridge, depthBelowCrest) {
  return ridge.haze + RIDGE_CREST_HAZE * (1 - Math.min(Math.max(depthBelowCrest / RIDGE_FADE_PX, 0), 1));
}

// The view numbers the screen layers need for a window `aspect` wide:
// { horizon (fraction from the top), zoom (zoomK) }, written into `out`.
export function hazeViewInto(aspect, out) {
  out.horizon = horizonScreenFraction(aspect);
  out.zoom = zoomK(fitView(aspect));
  return out;
}

// `color` mixed `amount` of the way toward `toward` (both '#rrggbb'), as
// [r, g, b] from 0 to 1.
export function mixHex(color, toward, amount) {
  const a = hexRgb(color);
  const b = hexRgb(toward);
  return a.map((v, i) => v + (b[i] - v) * amount);
}

export function hexRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
