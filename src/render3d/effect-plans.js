// Pure planning and timing for the 3D effects (docs/art-direction-v3.md
// sections 4 and 9): which visuals the logic events show, which board cells
// keep their plant hidden while a flying seed is on its way there and when
// that plant regrows from Land, the shape of every skill animation over
// time (reverse growth, the Wind Dash gust curve, the thrown seed's arc, the
// falling rock, the conversion spark), and the camera shake. Effects only
// follow the events returned by src/logic; nothing here feeds back into the
// rules. No DOM or Three.js, so it runs under node --test. The pose and
// shake functions read their time from, and write their results into, one
// object the caller keeps (pose.ageMs in, the pose out), so the per-frame
// animation never allocates or passes loose numbers around.

import {
  CONVERT_SPARK_MS, DASH_CURVE, DASH_LIFT, DASH_STREAK_MS, REVERSE_GROWTH_SPEED, ROCK_CRUMBLE_MS,
  ROCK_FALL_HEIGHT, ROCK_FALL_MS, ROCK_SETTLE_MS, SHAKE3D_LIGHT, SHAKE3D_MS, THROW_ARC_HEIGHT, THROW_DELAY_MS,
  THROW_MS,
} from '../config.js';
import { bannerTexts } from '../render/effects.js';
import { dropOffsetPx, STAGE_DROP, STAGE_LAND, STAGE_REST, STAGE_SPROUT } from './growth.js';

// Visual specs for the events of one action, in order:
//   { kind: 'place', x, y, player }       a seed planted (its growth cues are the piece layer's)
//   { kind: 'dashMark', from, to, player } petals circle the source, red brackets on the target, until the dash ends
//   { kind: 'dashStreak', from, to, player } the source bloom folds into a seed that rides a gust of
//                                         petals along a curve to the target and regrows there from Land
//   { kind: 'dashFizzle', from, to }      a failed dash: the mark ends with a puff
//   { kind: 'tornado', x, y, cells }      the swirl of petals and leaves over the zone, until it ends
//   { kind: 'tornadoEnd' }
//   { kind: 'throw', from, to, player }   a seed thrown in an arc, landing with a soil puff, then regrowing from Land
//   { kind: 'throwBlocked', x, y }        a gust around a plant with nowhere to go
//   { kind: 'rockFall', x, y }            a rock falls with a growing shadow, a soil puff and a light shake
//   { kind: 'rockCrumble', x, y }         a rock breaks into soil crumbs and pebbles
//   { kind: 'convert', x, y, from, to }   the plant wilts to Sprout, a spark runs through the soil and
//                                         it regrows from Land as `to`
//   { kind: 'endLingering' }              the game is over: marks and columns end
//   { kind: 'banner', text }              HUD banner text (same texts as the 2D game)
export function visualsForEvents(events) {
  const specs = [];
  for (const event of events) {
    switch (event.type) {
      case 'stonePlaced':
        specs.push({ kind: 'place', x: event.x, y: event.y, player: event.player });
        break;
      case 'dashAnnounced':
        specs.push({ kind: 'dashMark', from: event.from, to: event.to, player: event.player });
        break;
      case 'dashResolved':
        specs.push({ kind: 'dashStreak', from: event.from, to: event.to, player: event.player });
        break;
      case 'dashFailed':
        specs.push({ kind: 'dashFizzle', from: event.from, to: event.to });
        break;
      case 'tornadoAnnounced':
        specs.push({ kind: 'tornado', x: event.x, y: event.y, cells: event.cells });
        break;
      case 'tornadoEnded':
        specs.push({ kind: 'tornadoEnd' });
        break;
      case 'stoneThrown':
        specs.push({ kind: 'throw', from: event.from, to: event.to, player: event.player });
        break;
      case 'throwBlocked':
        specs.push({ kind: 'throwBlocked', x: event.x, y: event.y });
        break;
      case 'rockPlaced':
        specs.push({ kind: 'rockFall', x: event.x, y: event.y });
        break;
      case 'rockBroken':
        specs.push({ kind: 'rockCrumble', x: event.x, y: event.y });
        break;
      case 'stoneConverted':
        specs.push({ kind: 'convert', x: event.x, y: event.y, from: event.from, to: event.player });
        break;
      case 'win':
      case 'draw':
        // A win drops a pending dash and the zone without their own events.
        specs.push({ kind: 'endLingering' });
        break;
    }
  }
  for (const text of bannerTexts(events)) specs.push({ kind: 'banner', text });
  return specs;
}

// The visuals for events that piled up while the page was hidden (see
// frame-gap.js): only where the lingering marks end up, with no sparkles,
// flights, shakes or banners. At most one spec for the Wind Dash marks
// ('dashMark' to show them, 'dashClear' to hide them at once) and one for
// the Tornado Zone ('tornado' or 'tornadoClear'), each left out if no event
// touched it.
export function catchUpVisuals(events) {
  let dash; // undefined: untouched
  let tornado;
  for (const spec of visualsForEvents(events)) {
    switch (spec.kind) {
      case 'dashMark':
        dash = spec;
        break;
      case 'dashStreak':
      case 'dashFizzle':
        dash = null;
        break;
      case 'tornado':
        tornado = spec;
        break;
      case 'tornadoEnd':
        tornado = null;
        break;
      case 'endLingering':
        dash = null;
        tornado = null;
        break;
    }
  }
  const specs = [];
  if (dash !== undefined) specs.push(dash ?? { kind: 'dashClear' });
  if (tornado !== undefined) specs.push(tornado ?? { kind: 'tornadoClear' });
  return specs;
}

// How long a plant takes to fold back from stage `fromStage` to stage
// `toStage` when its growth plays backwards REVERSE_GROWTH_SPEED times
// faster than it grows (docs/art-direction-v3.md section 4). stageStartMs
// are the plant's stage start times (v3-meta.js stageStartMs).
export function reverseGrowthMs(stageStartMs, fromStage, toStage) {
  return Math.max(0, stageStartMs[fromStage] - stageStartMs[toStage]) / REVERSE_GROWTH_SPEED;
}

// The stage a plant shows pose.ageMs into folding back from `fromStage` to
// `toStage`: the growth timeline played backwards from the start of
// `fromStage`. Writes pose.frame and pose.done (from the end on, where it
// stays on `toStage`).
export function reverseGrowthInto(out, stageStartMs, fromStage, toStage) {
  const age = out.ageMs > 0 ? out.ageMs : 0;
  if (age >= reverseGrowthMs(stageStartMs, fromStage, toStage)) {
    out.frame = toStage;
    out.done = true;
    return out;
  }
  const forward = stageStartMs[fromStage] - age * REVERSE_GROWTH_SPEED;
  let frame = fromStage;
  while (frame > toStage && forward < stageStartMs[frame]) frame--;
  out.frame = frame;
  out.done = false;
  return out;
}

// Wind Dash: the resting bloom folds all the way back into a seed.
export function dashFoldMs(stageStartMs) {
  return reverseGrowthMs(stageStartMs, STAGE_REST, STAGE_DROP);
}

// Stone Conversion: the plant wilts back to Sprout, then the spark runs.
export function convertWiltMs(stageStartMs) {
  return reverseGrowthMs(stageStartMs, STAGE_REST, STAGE_SPROUT);
}

export function convertMs(stageStartMs) {
  return convertWiltMs(stageStartMs) + CONVERT_SPARK_MS;
}

// The cell whose plant stays hidden while a flying seed (or a falling
// rock, or the wilting old plant) shows it arriving, and for how long:
// { x, y, ms }, or null. The board already holds the piece; the effect
// shows it arriving. stageStartMs times the reverse growth.
export function heldCell(spec, stageStartMs) {
  switch (spec.kind) {
    case 'throw':
      return { x: spec.to.x, y: spec.to.y, ms: THROW_DELAY_MS + THROW_MS };
    case 'dashStreak':
      return { x: spec.to.x, y: spec.to.y, ms: dashFoldMs(stageStartMs) + DASH_STREAK_MS };
    case 'rockFall':
      return { x: spec.x, y: spec.y, ms: ROCK_FALL_MS + ROCK_SETTLE_MS };
    case 'convert':
      return { x: spec.x, y: spec.y, ms: convertMs(stageStartMs) };
    default:
      return null;
  }
}

// The plant that regrows from Land once its held cell shows again (a seed
// that flew there, a converted plant): { x, y, player, startMs }, or null.
// startMs is when, counted from the event, its seed would have been
// planted for it to enter Land just as the hold ends.
export function regrowCell(spec, stageStartMs) {
  let player;
  switch (spec.kind) {
    case 'throw':
    case 'dashStreak':
      player = spec.player;
      break;
    case 'convert':
      player = spec.to;
      break;
    default:
      return null;
  }
  const { x, y, ms } = heldCell(spec, stageStartMs);
  return { x, y, player, startMs: ms - stageStartMs[STAGE_LAND] };
}

// Shake strength in world units for a spec, 0 for none: only a rock
// landing shakes, lightly (docs/art-direction-v3.md section 5, High only).
export function shakeStrength(spec) {
  return spec.kind === 'rockFall' ? SHAKE3D_LIGHT : 0;
}

const clamp01 = (t) => Math.min(1, Math.max(0, t));
export const smoothstep = (t) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

// Height of an arc that starts and ends on the ground and peaks at `height`
// halfway.
export function arcHeight(t, height) {
  const u = clamp01(t);
  return 4 * height * u * (1 - u);
}

// A point pose.progress (0 to 1) along the Wind Dash gust from (fx, fz)
// to (tx, tz): a quadratic curve that bows sideways by DASH_CURVE of the
// way's length, rising DASH_LIFT above the board halfway. With `plain`
// (quality.js plainSlides) it is a straight slide along the ground. Writes
// pose.x, pose.z and pose.lift.
export function dashCurveInto(out, fx, fz, tx, tz, plain = false) {
  const u = clamp01(out.progress);
  const dx = tx - fx;
  const dz = tz - fz;
  const bow = plain ? 0 : DASH_CURVE;
  const cx = (fx + tx) / 2 - dz * bow;
  const cz = (fz + tz) / 2 + dx * bow;
  const a = (1 - u) * (1 - u);
  const b = 2 * u * (1 - u);
  const c = u * u;
  out.x = a * fx + b * cx + c * tx;
  out.z = a * fz + b * cz + c * tz;
  out.lift = plain ? 0 : arcHeight(u, DASH_LIFT);
  return out;
}

// Wind Dash pose.ageMs after it resolved: the source bloom folds back into
// a seed (reverse growth, dashFoldMs), then the seed rides the gust for
// DASH_STREAK_MS, easing in and out. pose.frame (the stage shown),
// pose.flying, pose.progress (0 to 1 along the gust), pose.done.
export function dashPose(out, stageStartMs) {
  const { ageMs } = out;
  reverseGrowthInto(out, stageStartMs, STAGE_REST, STAGE_DROP);
  const flight = ageMs - dashFoldMs(stageStartMs);
  out.flying = out.done && flight > 0;
  out.progress = smoothstep(flight / DASH_STREAK_MS);
  out.done = flight >= DASH_STREAK_MS;
  out.ageMs = ageMs;
  return out;
}

// A thrown seed pose.ageMs after it was planted: it drops onto its plot
// for THROW_DELAY_MS (pose.dropPx art pixels above it, as a growing seed
// drops), then flies in an arc for THROW_MS (with `plain`, quality.js
// plainSlides, it slides along the ground instead). pose.progress along the
// way, pose.height, pose.done.
export function throwPose(out, plain = false) {
  const { ageMs } = out;
  out.dropPx = dropOffsetPx(ageMs);
  const t = clamp01((ageMs - THROW_DELAY_MS) / THROW_MS);
  out.progress = t;
  out.height = plain ? 0 : arcHeight(t, THROW_ARC_HEIGHT);
  out.done = ageMs >= THROW_DELAY_MS + THROW_MS;
  return out;
}

// A falling rock pose.ageMs after Terrain Creation: it drops from
// ROCK_FALL_HEIGHT, speeding up, while its shadow grows from small to full;
// then it squashes and settles. pose.height, pose.shadow (shadow scale),
// pose.scaleX, pose.scaleY, pose.landed (from the impact on), pose.done.
export function rockFallPose(out) {
  const { ageMs } = out;
  const fall = clamp01(ageMs / ROCK_FALL_MS);
  out.height = ROCK_FALL_HEIGHT * (1 - fall * fall);
  out.shadow = 0.2 + 0.8 * fall * fall;
  out.landed = ageMs >= ROCK_FALL_MS;
  const settle = clamp01((ageMs - ROCK_FALL_MS) / ROCK_SETTLE_MS);
  const squash = out.landed ? 0.22 * (1 - settle) : 0;
  out.scaleX = 1 + squash;
  out.scaleY = 1 - squash;
  out.done = ageMs >= ROCK_FALL_MS + ROCK_SETTLE_MS;
  return out;
}

// A breaking rock pose.ageMs after it broke sinks and spreads into soil
// crumbs and pebbles: pose.scaleX, pose.scaleY, pose.done.
export function crumblePose(out) {
  const { ageMs } = out;
  const t = clamp01(ageMs / ROCK_CRUMBLE_MS);
  out.scaleX = 1 + 0.3 * t;
  out.scaleY = Math.max(0.05, 1 - t * t);
  out.done = ageMs >= ROCK_CRUMBLE_MS;
  return out;
}

// Stone Conversion pose.ageMs in: the old plant wilts back to Sprout
// (reverse growth, convertWiltMs), then a small spark runs through the soil
// for CONVERT_SPARK_MS, after which the other team's plant regrows from
// Land (the piece layer grows it, see regrowCell). pose.frame (the old
// plant's stage), pose.spark (-1 before the spark, then 0 to 1 along its
// path), pose.done.
export function convertPose(out, stageStartMs) {
  const { ageMs } = out;
  reverseGrowthInto(out, stageStartMs, STAGE_REST, STAGE_SPROUT);
  const wiltMs = convertWiltMs(stageStartMs);
  out.spark = ageMs < wiltMs ? -1 : clamp01((ageMs - wiltMs) / CONVERT_SPARK_MS);
  out.done = ageMs >= wiltMs + CONVERT_SPARK_MS;
  out.ageMs = ageMs;
  return out;
}

// Where the conversion spark is at pose.spark (0 to 1) on the plot centred
// on (wx, wz): it enters at the plot's upper left (where the wind comes
// from), wriggles through the soil and ends under the plant at the centre.
// Writes pose.x and pose.z.
export const SPARK_REACH = 0.42; // world units from the plot centre where the spark starts
export function sparkPathInto(out, wx, wz) {
  const t = clamp01(out.spark);
  const along = SPARK_REACH * (1 - t);
  const wriggle = 0.08 * Math.sin(3 * Math.PI * t) * (1 - t);
  out.x = wx - along + wriggle;
  out.z = wz - along - wriggle;
  return out;
}

// Camera shake shake.ageMs into a shake of shake.strength world units: a
// quick wobble that dies out over SHAKE3D_MS. Writes shake.x and shake.y,
// how far to move the camera along its own right and up directions.
export function shakeOffset3d(out) {
  const { ageMs, strength } = out;
  if (!(ageMs >= 0) || ageMs >= SHAKE3D_MS || !(strength > 0)) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const fade = 1 - ageMs / SHAKE3D_MS;
  const amplitude = strength * fade * fade;
  out.x = amplitude * Math.sin(ageMs * 0.11);
  out.y = amplitude * Math.cos(ageMs * 0.15);
  return out;
}

// How strong a shake that started `ageMs` ago still is, to decide whether a
// new shake should replace it.
export function shakeLeft(ageMs, strength) {
  if (!(ageMs >= 0) || ageMs >= SHAKE3D_MS) return 0;
  const fade = 1 - ageMs / SHAKE3D_MS;
  return strength * fade * fade;
}

// World units that one screen pixel covers at `distance` from a camera with
// a vertical field of view of fovDeg drawing heightPx pixels tall.
export function worldUnitsPerPixel(distance, fovDeg, heightPx) {
  return (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx);
}

// Rounds `value` to whole steps, so a camera offset moves the board by
// whole screen pixels and sprite pixels never shimmer.
export function snapToStep(value, step) {
  if (!(step > 0)) return value;
  return Math.round(value / step) * step;
}
