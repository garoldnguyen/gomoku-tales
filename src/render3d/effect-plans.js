// Pure planning and timing for the 3D effects (docs/art-direction-hd2d.md
// section G): which visuals the logic events show, which board cells keep
// their piece hidden while a flying copy is on its way there, the shape of
// every skill animation over time, and the camera shake. Effects only
// follow the events returned by src/logic; nothing here feeds back into the
// rules. No DOM or Three.js, so it runs under node --test. The pose and
// shake functions read their time from, and write their results into, one
// object the caller keeps (pose.ageMs in, the pose out), so the per-frame
// animation never allocates or passes loose numbers around.

import {
  CONVERT_LIFT, CONVERT_MS, DASH_STREAK_MS, ROCK_CRUMBLE_MS, ROCK_FALL_HEIGHT, ROCK_FALL_MS,
  ROCK_SETTLE_MS, SHAKE3D_HEAVY, SHAKE3D_LIGHT, SHAKE3D_MS, THROW_ARC_HEIGHT, THROW_DELAY_MS, THROW_MS,
} from '../config.js';
import { bannerTexts } from '../render/effects.js';
import { popInScaleInto } from './character-poses.js';

// Visual specs for the events of one action, in order:
//   { kind: 'place', x, y, player }       sparkles, a dust puff, a light shake
//   { kind: 'dashMark', from, to, player } swirl on the source, red frame on the target, until the dash ends
//   { kind: 'dashStreak', from, to, player } the stone streaks to the target with a trail
//   { kind: 'dashFizzle', from, to }      a failed dash: the mark ends with a puff
//   { kind: 'tornado', x, y, cells }      the swirling column over the zone, until it ends
//   { kind: 'tornadoEnd' }
//   { kind: 'throw', from, to, player }   a stone thrown in an arc, landing with a dust puff
//   { kind: 'throwBlocked', x, y }        a gust around a stone with nowhere to go
//   { kind: 'rockFall', x, y }            a rock falls with a growing shadow, dust and a shake
//   { kind: 'rockCrumble', x, y }         a rock breaks into rubble and dust
//   { kind: 'convert', x, y, from, to }   the stone glows, lifts, flips and lands as `to`
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

// The cell whose piece stays hidden while a flying copy is on its way
// there, and for how long: { x, y, ms }, or null. The board already holds
// the piece; the effect shows it arriving.
export function heldCell(spec) {
  switch (spec.kind) {
    case 'throw':
      return { x: spec.to.x, y: spec.to.y, ms: THROW_DELAY_MS + THROW_MS };
    case 'dashStreak':
      return { x: spec.to.x, y: spec.to.y, ms: DASH_STREAK_MS };
    case 'rockFall':
      return { x: spec.x, y: spec.y, ms: ROCK_FALL_MS + ROCK_SETTLE_MS };
    case 'convert':
      return { x: spec.x, y: spec.y, ms: CONVERT_MS };
    default:
      return null;
  }
}

// Shake strength in world units for a spec, 0 for none: light for
// placements and landings, heavy for a falling rock.
export function shakeStrength(spec) {
  switch (spec.kind) {
    case 'place':
    case 'dashStreak':
    case 'throw':
    case 'convert':
      return SHAKE3D_LIGHT;
    case 'rockFall':
      return SHAKE3D_HEAVY;
    default:
      return 0;
  }
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

// Wind Dash pose.ageMs into the streak: pose.progress (0 to 1 along the
// way, easing in and out), pose.lift above the board, pose.done.
export function dashPose(out) {
  const { ageMs } = out;
  const t = clamp01(ageMs / DASH_STREAK_MS);
  out.progress = smoothstep(t);
  out.lift = 0.18 * Math.sin(Math.PI * t);
  out.done = ageMs >= DASH_STREAK_MS;
  return out;
}

// A thrown stone pose.ageMs after it was placed: it shows on that cell
// (popping in) for THROW_DELAY_MS, then flies in an arc for THROW_MS.
// pose.progress along the way, pose.height, pose.scaleX and pose.scaleY,
// pose.done.
export function throwPose(out) {
  const { ageMs } = out;
  popInScaleInto(ageMs, out, THROW_DELAY_MS);
  const t = clamp01((ageMs - THROW_DELAY_MS) / THROW_MS);
  out.progress = t;
  out.height = arcHeight(t, THROW_ARC_HEIGHT);
  out.scaleX = out.x;
  out.scaleY = out.y;
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

// A breaking rock pose.ageMs after it broke sinks and spreads into rubble:
// pose.scaleX, pose.scaleY, pose.done.
export function crumblePose(out) {
  const { ageMs } = out;
  const t = clamp01(ageMs / ROCK_CRUMBLE_MS);
  out.scaleX = 1 + 0.3 * t;
  out.scaleY = Math.max(0.05, 1 - t * t);
  out.done = ageMs >= ROCK_CRUMBLE_MS;
  return out;
}

// Stone Conversion phases, as shares of CONVERT_MS.
export const CONVERT_PHASES = Object.freeze({ glowEnd: 0.25, liftEnd: 0.42, flipEnd: 0.78 });

// Stone Conversion pose.ageMs in: the stone glows, lifts, flips like a
// coin (it turns edge-on halfway, where the other colour takes over) and
// lands. pose.glow (0 to 1), pose.lift, pose.width (horizontal scale),
// pose.showNew, pose.done.
export function convertPose(out) {
  const { ageMs } = out;
  const { glowEnd, liftEnd, flipEnd } = CONVERT_PHASES;
  const t = clamp01(ageMs / CONVERT_MS);
  if (t < glowEnd) out.glow = t / glowEnd;
  else if (t < flipEnd) out.glow = 1;
  else out.glow = 1 - (t - flipEnd) / (1 - flipEnd);

  if (t < glowEnd) out.lift = 0;
  else if (t < liftEnd) out.lift = CONVERT_LIFT * (1 - (1 - (t - glowEnd) / (liftEnd - glowEnd)) ** 2);
  else if (t < flipEnd) out.lift = CONVERT_LIFT;
  else out.lift = CONVERT_LIFT * (1 - ((t - flipEnd) / (1 - flipEnd)) ** 2);

  const angle = Math.PI * smoothstep((t - liftEnd) / (flipEnd - liftEnd));
  out.width = Math.max(0.08, Math.abs(Math.cos(angle)));
  out.showNew = angle > Math.PI / 2;
  out.done = ageMs >= CONVERT_MS;
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
