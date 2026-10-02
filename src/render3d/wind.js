// Pure wind and sway math for the meadow (docs/art-direction-v3.md section
// 6, High only): the one wind direction, the gust timing, the lean of a
// swaying plant and the release times of the dandelion seed flecks. The
// meadow vertex shader (meadow-scene.js) uses the same formula as
// swayLeanPx. No Three.js imports, so it runs under node --test.

import {
  DANDELION_FLECK_MS, DANDELION_FLECK_SPEED, DANDELION_RELEASE_MS, GUST_EVERY_MS, GUST_MS, PLANT_SWAY_SHARE,
  SWAY_CALM_PX, SWAY_GUST_PX, SWAY_PERIOD_MS, WIND_DIR,
} from '../config.js';

// The wind on the ground: WIND_DIR without its y, normalised. It blows from
// the upper left of the screen toward the lower right.
const GROUND_LENGTH = Math.hypot(WIND_DIR[0], WIND_DIR[2]);
export const WIND_GROUND = Object.freeze({ x: WIND_DIR[0] / GROUND_LENGTH, z: WIND_DIR[2] / GROUND_LENGTH });

// Gust strength 0 to 1 at `msIntoGust` ms after a gust started: it rises
// and falls once over GUST_MS (a half sine), 0 outside it.
export function gustEnvelope(msIntoGust, gustMs = GUST_MS) {
  if (!(msIntoGust > 0) || msIntoGust >= gustMs) return 0;
  return Math.sin((Math.PI * msIntoGust) / gustMs);
}

// The gusts: one starts every GUST_EVERY_MS (7 to 11 seconds, picked by
// `random`, a function returning numbers in [0, 1)) and lasts GUST_MS.
// strength(timeMs) is 0 in calm wind and up to 1 in a gust. Times must
// mostly go forward; going back starts the schedule again from that time.
// No allocations per call.
export function createGustClock(random, { everyMs = GUST_EVERY_MS, gustMs = GUST_MS } = {}) {
  const gap = () => everyMs[0] + random() * (everyMs[1] - everyMs[0]);
  let start = NaN; // the latest gust start not after the time asked
  let next = NaN;
  return {
    strength(timeMs) {
      if (Number.isNaN(next) || timeMs < start) {
        start = timeMs - gustMs; // the first gust is a gap away, calm until then
        next = timeMs + gap();
      }
      while (timeMs >= next) {
        start = next;
        next += gap();
      }
      return gustEnvelope(timeMs - start, gustMs);
    },
    // When the next gust starts (after the last strength() call).
    get nextGustMs() {
      return next;
    },
  };
}

// Art pixels of sway at full gust strength g (0 calm to 1 gust): 1 pixel in
// calm wind, 2 in a gust.
export function swayAmplitudePx(gust) {
  const g = Math.min(Math.max(gust, 0), 1);
  return SWAY_CALM_PX + (SWAY_GUST_PX - SWAY_CALM_PX) * g;
}

// Art pixels of sway of a resting X or O plant on the board: half the
// meadow's amplitude, so 0.5 in calm wind and 1 in a gust. Draw it with
// plantSwayLeanPx, which shows the half pixel in whole pixels.
export function plantSwayAmplitudePx(gust) {
  return swayAmplitudePx(gust) * PLANT_SWAY_SHARE;
}

// The phase (radians) of a plant's sway, from its position, so neighbours
// do not move in step.
export function swayPhase(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * Math.PI * 2;
}

// How many whole art pixels the point at height fraction h (0 at the root,
// 1 at the top) of a plant leans downwind at `timeMs` with sway amplitude
// `amplitudePx`: amplitude times h squared times a slow wave between 0 and
// 1, rounded to whole pixels so the art stays crisp. The root never moves
// and the lean never goes upwind.
export function swayLeanPx(h, phase, timeMs, amplitudePx, periodMs = SWAY_PERIOD_MS) {
  const f = Math.min(Math.max(h, 0), 1);
  const wave = 0.5 + 0.5 * Math.sin((timeMs / periodMs) * Math.PI * 2 + phase);
  return Math.floor(amplitudePx * f * f * wave + 0.5);
}

// How many whole art pixels the point at height fraction h of a resting X
// or O plant leans at `timeMs`, with its half amplitude `amplitudePx`
// (plantSwayAmplitudePx). Half a pixel cannot be drawn, and swayLeanPx
// would round 0.5 pixel of calm sway to 0 except at the very crest, so the
// plant would stand still. Instead, where amplitude times h squared is
// below 1 pixel, the row leans 1 whole pixel for that share of the time it
// would on average: for the fraction (amplitudePx * h * h) / 2 of each
// wave, around its crest. The top of a plant in calm wind (0.5 pixel)
// leans 1 pixel a quarter of the time, half as much on average as a meadow
// flower's top (1 pixel half the time); in a gust (1 pixel) it leans just
// like a calm meadow flower. At 1 pixel and more it is swayLeanPx, so the
// two meet without a jump. The root never moves.
export function plantSwayLeanPx(h, phase, timeMs, amplitudePx, periodMs = SWAY_PERIOD_MS) {
  const f = Math.min(Math.max(h, 0), 1);
  const reach = amplitudePx * f * f;
  if (reach >= 1) return swayLeanPx(h, phase, timeMs, amplitudePx, periodMs);
  if (!(reach > 0)) return 0;
  const wave = Math.sin((timeMs / periodMs) * Math.PI * 2 + phase);
  return wave >= Math.cos((Math.PI / 2) * reach) ? 1 : 0;
}

// The height fraction h of art pixel row `rowFromBottom` (0 is the bottom
// row) of a sprite whose root (anchor) is row `rootRow` from the bottom
// and whose top row is `heightPx - 1`: 0 at and below the root, 1 at the
// top. Each row leans as one, by whole pixels, so the art stays crisp.
export function swayRowFraction(rowFromBottom, heightPx, rootRow = 0) {
  const span = heightPx - 1 - rootRow;
  if (!(span > 0)) return 0;
  return Math.min(Math.max((rowFromBottom - rootRow) / span, 0), 1);
}

// The time after `fromMs` at which a dandelion seed puff lets its next
// seed fleck go: 6 to 10 seconds later, picked by `random`.
export function nextReleaseMs(fromMs, random, everyMs = DANDELION_RELEASE_MS) {
  return fromMs + everyMs[0] + random() * (everyMs[1] - everyMs[0]);
}

// The release clock of `count` dandelion seed puffs: each lets one seed
// fleck go every 6 to 10 seconds (nextReleaseMs), on its own timer, the
// first ones spread over one interval so the puffs do not go together.
// step(timeMs, release) calls release(puffIndex) for every puff whose time
// has come. A pause longer than a fleck's life (a hidden tab) starts the
// timers over instead of letting every puff go at once. clear() starts
// them over too. No allocations per call.
export function createPuffReleases(count, random, everyMs = DANDELION_RELEASE_MS) {
  const next = new Float64Array(count).fill(NaN);
  return {
    step(timeMs, release) {
      for (let p = 0; p < count; p++) {
        if (Number.isNaN(next[p]) || timeMs - next[p] > DANDELION_FLECK_MS) {
          next[p] = nextReleaseMs(timeMs - everyMs[0] * random(), random, everyMs);
        }
        if (timeMs >= next[p]) {
          release(p);
          next[p] = nextReleaseMs(timeMs, random, everyMs);
        }
      }
    },
    clear() {
      next.fill(NaN);
    },
  };
}

// World units per second a seed fleck drifts along WIND_GROUND at gust
// strength `gust` (0 to 1): a gust triples it.
export function fleckSpeed(gust) {
  return DANDELION_FLECK_SPEED * (1 + 2 * Math.min(Math.max(gust, 0), 1));
}

// Which way along the width of an upright plane turned by yaw (given as
// cos and sin of it, Three.js's rotation about y) a plant leans downwind:
// +1 or -1. Only the sign of the wind along the plane is used, so the lean
// is always a whole number of art pixels, never a part of one.
export function swayLeanSide(cosYaw, sinYaw) {
  return WIND_GROUND.x * cosYaw - WIND_GROUND.z * sinYaw < 0 ? -1 : 1;
}
