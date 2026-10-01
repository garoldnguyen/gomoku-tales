// Quality levels for the HD-2D scene (docs/art-direction-hd2d.md section E)
// and the pure logic that steps down a level when frames are too slow.
// No Three.js imports, so this runs under node --test.
//
//   HIGH    depth of field (BokehPass), bloom, vignette, real shadow maps
//   MEDIUM  cheaper blur (tilt shift), bloom at half resolution, vignette,
//           blob shadows only (the default)
//   LOW     no post-processing, blob shadows only
//
// Tone mapping is on at every level. Blob shadows under sprites are always on.
// `particles` scales the particle counts and rates of the 3D effects
// (src/render3d/effects3d.js): full at HIGH, fewer at MEDIUM and LOW.

export const QUALITY_ORDER = ['HIGH', 'MEDIUM', 'LOW']; // best first

export const QUALITY_LEVELS = Object.freeze({
  HIGH: Object.freeze({
    name: 'HIGH',
    postProcessing: true,
    depthOfField: 'bokeh',
    bloom: true,
    bloomResolution: 1, // share of the full render size
    vignette: true,
    shadowMaps: true,
    particles: 1,
  }),
  MEDIUM: Object.freeze({
    name: 'MEDIUM',
    postProcessing: true,
    depthOfField: 'tiltShift',
    bloom: true,
    bloomResolution: 0.5,
    vignette: true,
    shadowMaps: false,
    particles: 0.6,
  }),
  LOW: Object.freeze({
    name: 'LOW',
    postProcessing: false,
    depthOfField: 'none',
    bloom: false,
    bloomResolution: 0,
    vignette: false,
    shadowMaps: false,
    particles: 0.35,
  }),
});

function indexOf(level) {
  const i = QUALITY_ORDER.indexOf(level);
  if (i < 0) throw new Error(`Unknown quality level: ${level}`);
  return i;
}

// The Q key: HIGH -> MEDIUM -> LOW -> HIGH.
export function cycleQuality(level) {
  return QUALITY_ORDER[(indexOf(level) + 1) % QUALITY_ORDER.length];
}

// One level lower; LOW stays LOW.
export function lowerQuality(level) {
  return QUALITY_ORDER[Math.min(indexOf(level) + 1, QUALITY_ORDER.length - 1)];
}

// Pixel ratio for the renderer: the screen's, capped at renderScale.
export function cappedPixelRatio(devicePixelRatio, renderScale) {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(ratio, renderScale);
}

// Watches frame times and says when to step down a level. Feed tick() the
// requestAnimationFrame timestamp every frame. It keeps the most recent
// frames that cover holdMs; once they do and their average frame time is
// above targetFrameMs, tick() returns true and the watch starts over, so the
// next level gets a fresh holdMs. A frame longer than stallMs (a hidden tab,
// a shader compile) is not load: it starts the watch over. Call reset()
// after changing the level by hand. No allocations per frame.
export function createSlowFrameWatch({ targetFrameMs, holdMs, stallMs, capacity = 1024 }) {
  const durations = new Float64Array(capacity); // ring buffer, oldest at head
  let head = 0;
  let count = 0;
  let sum = 0;
  let lastNow = null;

  function clear() {
    head = 0;
    count = 0;
    sum = 0;
  }

  function dropOldest() {
    sum -= durations[head];
    head = (head + 1) % capacity;
    count--;
  }

  return {
    tick(nowMs) {
      if (lastNow === null || !Number.isFinite(nowMs)) {
        lastNow = Number.isFinite(nowMs) ? nowMs : null;
        return false;
      }
      const dt = nowMs - lastNow;
      lastNow = nowMs;
      if (!(dt >= 0) || dt > stallMs) {
        clear();
        return false;
      }
      if (count === capacity) dropOldest();
      durations[(head + count) % capacity] = dt;
      count++;
      sum += dt;
      // Keep only the newest frames that still cover holdMs.
      while (count > 1 && sum - durations[head] >= holdMs) dropOldest();
      if (sum >= holdMs && sum / count > targetFrameMs) {
        clear();
        return true;
      }
      return false;
    },
    reset() {
      clear();
      lastNow = null;
    },
    // Average frame time of the frames being watched, 0 when there are none.
    get averageMs() {
      return count ? sum / count : 0;
    },
  };
}
