// Pure sky math (docs/art-direction-v3.md section 7): the gradient, where
// the painted clouds and wisps stand and how they drift and wrap around,
// and the breath of the sun rays. Clouds, wisps and rays live in the fixed
// camera's own space (x right, y up, looking down -z), so screen spots map
// straight onto them. No Three.js imports, so this runs under node --test.

import {
  CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, CLOUD_LAYERS, DRIFT_CLOUD_BOTTOMS, PX_WORLD, SKY_HORIZON_FRACTION,
  SKY_STOPS, STILL_CLOUDS, SUN_RAY_ALPHA, SUN_RAY_COUNT, SUN_RAY_LOW, SUN_RAY_PERIOD_MS, WISP_COUNT, WISP_HEIGHTS,
  WISP_PX,
} from '../config.js';
import { seededRandom } from './seeded-random.js';
import { WIND_GROUND } from './wind.js';

const DEG = Math.PI / 180;
export const VIEW_ASPECT = 16 / 9; // the world view is always 16:9 (world.js)
export const CLOUD_FRAME_PX = [148, 56]; // one shape of clouds.png
export const CLOUD_SHAPES = 6;
const SKY_SEED = 7070;

// Drifting clouds and wisps blend with real alpha. Their materials discard
// a pixel only when its final opacity (texel alpha times the material's
// opacity) is below this, as Three.js alphaTest does, so a soft or faint
// pixel never pops out.
export const SKY_ALPHA_CUTOFF = 0.01;
export function skyPixelDiscarded(opacity, cutoff = SKY_ALPHA_CUTOFF) {
  return opacity < cutoff;
}

// The gradient stops on the whole view, top 0 to bottom 1: SKY_STOPS
// squeezed from the top down to the horizon, the horizon colour below it.
export function skyGradientStops(horizon = SKY_HORIZON_FRACTION) {
  const stops = SKY_STOPS.map(([at, color]) => [at * horizon, color]);
  if (horizon < 1) stops.push([1, SKY_STOPS[SKY_STOPS.length - 1][1]]);
  return stops;
}

// Half the width and height of the view at `depth` world units in front
// of the camera.
export function viewHalfExtent(depth, fovDeg = CAMERA_FOV, aspect = VIEW_ASPECT) {
  const halfH = Math.tan((fovDeg * DEG) / 2) * depth;
  return { halfW: halfH * aspect, halfH };
}

// Camera-space x and y of the screen spot (fx, fy) (fractions of the view,
// from the left and from the top) at `depth`.
export function screenToView(fx, fy, depth, fovDeg = CAMERA_FOV, aspect = VIEW_ASPECT) {
  const { halfW, halfH } = viewHalfExtent(depth, fovDeg, aspect);
  return { x: (fx * 2 - 1) * halfW, y: (1 - fy * 2) * halfH };
}

// World units per art pixel of something at `depth` drawn at `scale`: at
// scale 1 its pixels look as big as the board's (the board centre is
// CAMERA_DISTANCE away and uses PX_WORLD).
export function pixelWorldAt(depth, scale = 1) {
  return PX_WORLD * (depth / CAMERA_DISTANCE) * scale;
}

// `value` wrapped into [min, min + span).
export function wrapAround(value, min, span) {
  return min + ((((value - min) % span) + span) % span);
}

// The camera-space x range a thing `width` wide at `depth` wraps around
// in: from just past the left edge of the view to just past the right
// edge, so it always leaves and comes back out of sight.
export function wrapRange(depth, width, fovDeg = CAMERA_FOV, aspect = VIEW_ASPECT) {
  const { halfW } = viewHalfExtent(depth, fovDeg, aspect);
  const min = -(halfW + width / 2);
  return { min, span: -2 * min };
}

// The one wind (wind.js WIND_GROUND) as it looks through the fixed camera
// that looks down `pitchDeg`: a unit vector in camera space, x right and
// y up. Across the wind stays across the screen; along the ground toward
// the camera shows as down the screen, shortened by the pitch. So it
// points right and a little down: from the upper left to the lower right.
export function windOnScreen(pitchDeg = CAMERA_PITCH_DEG) {
  const x = WIND_GROUND.x;
  const y = -WIND_GROUND.z * Math.sin(pitchDeg * DEG);
  const length = Math.hypot(x, y);
  return Object.freeze({ x: x / length, y: y / length });
}
export const SCREEN_WIND = windOnScreen();

// Where a drifting cloud or wisp `c` is at `timeMs`, written into `out`
// (no allocation). Clouds are high above the ground, so they drift
// straight to the right on screen at `speed` world units per second and
// keep their height. x wraps around c.range, so a cloud leaves fully off
// the right edge and comes back fully off the left edge.
export function skyDrift(c, timeMs, out) {
  out.x = wrapAround(c.x + (c.speed * timeMs) / 1000, c.range.min, c.range.span);
  out.y = c.y;
  return out;
}

function cloud(layerName, frame, x, bottom) {
  const layer = CLOUD_LAYERS[layerName];
  const pxWorld = pixelWorldAt(layer.depth, layer.scale);
  return {
    layer: layerName,
    frame,
    depth: layer.depth,
    speed: layer.speed,
    pxWorld,
    width: CLOUD_FRAME_PX[0] * pxWorld,
    height: CLOUD_FRAME_PX[1] * pxWorld,
    x, // camera-space centre
    y: screenToView(0.5, bottom, layer.depth).y, // camera-space flat bottom
  };
}

// Medium: the 4 still clouds of STILL_CLOUDS.
export function planStillClouds() {
  return STILL_CLOUDS.map((spot) => {
    const depth = CLOUD_LAYERS[spot.layer].depth;
    return cloud(spot.layer, spot.frame, screenToView(spot.x, spot.y, depth).x, spot.y);
  });
}

// High: 4 far and 4 near clouds, spread evenly over their wrap range with
// a little seeded jitter, each with its flat bottom at its spot in
// DRIFT_CLOUD_BOTTOMS. x is where each one is at time 0; it then drifts
// with skyDrift.
export function planDriftClouds(seed = SKY_SEED) {
  const random = seededRandom(seed);
  const clouds = [];
  for (const layerName of ['far', 'near']) {
    const bottoms = DRIFT_CLOUD_BOTTOMS[layerName];
    const count = bottoms.length;
    for (let i = 0; i < count; i++) {
      const frame = (i * 2 + (layerName === 'far' ? 1 : 0)) % CLOUD_SHAPES;
      const c = cloud(layerName, frame, 0, bottoms[i]);
      c.range = wrapRange(c.depth, c.width);
      c.x = c.range.min + ((i + 0.3 + random() * 0.4) / count) * c.range.span;
      clouds.push(c);
    }
  }
  return clouds;
}

// High: WISP_COUNT thin soft streaks at the far layer's depth, drifting
// with it (skyDrift), their centres at WISP_HEIGHTS.
export function planWisps(seed = SKY_SEED + 1) {
  const random = seededRandom(seed);
  const { depth, speed, scale } = CLOUD_LAYERS.far;
  const pxWorld = pixelWorldAt(depth, scale);
  const width = WISP_PX[0] * pxWorld;
  const height = WISP_PX[1] * pxWorld;
  const range = wrapRange(depth, width);
  return Array.from({ length: WISP_COUNT }, (_, i) => ({
    depth,
    speed,
    width,
    height,
    range,
    x: range.min + ((i + random()) / WISP_COUNT) * range.span,
    y: screenToView(0.5, WISP_HEIGHTS[i], depth).y,
  }));
}

// Opacity of sun ray `index` at `timeMs`: it breathes between SUN_RAY_LOW
// and 1 times SUN_RAY_ALPHA once every SUN_RAY_PERIOD_MS, the rays a third
// of a breath apart.
export function sunRayAlpha(index, timeMs) {
  const phase = (timeMs / SUN_RAY_PERIOD_MS + index / SUN_RAY_COUNT) * Math.PI * 2;
  const breath = 0.5 - 0.5 * Math.cos(phase);
  return SUN_RAY_ALPHA * (SUN_RAY_LOW + (1 - SUN_RAY_LOW) * breath);
}
