// Quality levels for the farmland scene: ONE feature table, exactly as
// docs/art-direction-v3.md section 5 lists it with the rows that
// docs/art-direction-v3-1.md section 7 adds, plus the pure logic that
// picks, saves and steps down a level. Every render3d module reads its
// switches from QUALITY_LEVELS (through qualityFeatures); nothing else tests
// a level name. Each level only adds to the one below it, except the board
// texture, which Low swaps for a lighter one. No Three.js imports, so this
// runs under node --test.

export const QUALITY_ORDER = ['high', 'medium', 'low']; // best first
export const QUALITY_FALLBACK = 'medium'; // unknown values use this
export const QUALITY_STORAGE_KEY = 'gomoku-tales.quality';

export const QUALITY_LEVELS = deepFreeze({
  low: {
    name: 'low',
    goal: 'clear and easy to play',
    pixelRatioCap: 1,
    boardTexture: 'farm-board-low',
    ground: 'mown', // flat mown meadow: two greens in 3-cell stripes, nothing else
    scenery: false, // trees, bushes, hay, fence, path, stepping stones (the curb always shows)
    meadowFlowers: 'off',
    skyHaze: true, // the sky gradient runs to the haze colour at the horizon
    groundFog: true, // the soft ground edge
    ridges: false, // the two soft ridges behind the far edge
    floorShade: false, // the forest floor shade
    forestWall: false, // the far canopy wall (docs/art-direction-v3-1.md section 6)
    treeRows: 0, // forest tree rows; their steps are FOREST_ROWS in forest.js
    undergrowth: 0, // forest undergrowth per world unit
    forestLogs: 0, // logs and stumps among the undergrowth
    sky: 'gradient',
    shadows: 'none',
    postEffects: { bloom: false, depthOfField: false, warmGrade: false, vignette: false },
    wind: false,
    plantInBetween: 0, // in-between growth frames per stage change (plant-frames.js): the 5 stage frames only
    growthExtras: { openSparkles: false, soilPuff: false, rockShake: false },
    skillEffects: 'simple', // marks and a short slide, no particles
    particleCap: 0,
    hudFrost: { blurPx: 0, shadow: 'none' },
    backgroundMotion: false,
  },
  medium: {
    name: 'medium',
    goal: 'shades and a lived-in farm',
    pixelRatioCap: 1.5,
    boardTexture: 'farm-board',
    ground: 'painted', // painted mottled meadow, grass tufts
    scenery: true,
    meadowFlowers: 'still',
    skyHaze: true,
    groundFog: true,
    ridges: true,
    floorShade: false,
    forestWall: true,
    treeRows: 2, // rows 1 and 3
    undergrowth: 2.1,
    forestLogs: 1,
    sky: 'still-clouds', // gradient plus 4 still painted clouds
    shadows: 'blob', // soft blob shadow under every plant, rock, post, tree, bush, bale
    postEffects: { bloom: false, depthOfField: false, warmGrade: false, vignette: false }, // no blur at all
    wind: false,
    plantInBetween: 2, // 2 per stage change: 13 frames in all
    growthExtras: { openSparkles: true, soilPuff: false, rockShake: false },
    skillEffects: 'particles', // marks, slides, a few particles
    particleCap: 60,
    hudFrost: { blurPx: 10, shadow: 'small' },
    backgroundMotion: false,
  },
  high: {
    name: 'high',
    goal: 'shades, depth, clouds and wind',
    pixelRatioCap: 2,
    boardTexture: 'farm-board',
    ground: 'painted-ripples', // painted meadow plus slow lighter wind ripples
    scenery: true,
    meadowFlowers: 'sway', // swaying, dandelion puffs lift off
    skyHaze: true,
    groundFog: true,
    ridges: true,
    floorShade: true,
    forestWall: true,
    treeRows: 3, // rows 1, 2 and 3
    undergrowth: 3.2,
    forestLogs: 3,
    sky: 'drifting-clouds', // 8 drifting clouds in 2 layers, wisps, sun rays
    shadows: 'sun', // long sun shadows plus slow cloud shadows
    postEffects: { bloom: true, depthOfField: true, warmGrade: true, vignette: true },
    wind: true, // petals, leaves and seed fluff in 3 lanes; grass, flowers and plants sway
    plantInBetween: 2,
    growthExtras: { openSparkles: true, soilPuff: true, rockShake: true },
    skillEffects: 'full',
    particleCap: 220,
    hudFrost: { blurPx: 18, shadow: 'soft' },
    backgroundMotion: true, // clouds, wind, sway, rays
  },
});

// --- URL switches for the High-only effects (docs/art-direction-v3.md section 5) ---

// ?fx=off turns off every High-only effect; ?dof=off, ?bloom=off,
// ?wind=off, ?rays=off, ?shadows=off and ?ripples=off one each. Each also
// takes 'on', so ?fx=off&dof=on leaves only the depth of field.
export const FX_SWITCHES = Object.freeze(['dof', 'bloom', 'wind', 'rays', 'shadows', 'ripples']);
// What each parsed switch is: true is on. grade (the warm grade and the
// vignette) has no URL switch of its own; only ?fx=off turns it off.
export const FX_ALL_ON = Object.freeze({ dof: true, bloom: true, wind: true, rays: true, shadows: true, ripples: true, grade: true });

function switchValue(value) {
  const word = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return word === 'off' ? false : word === 'on' ? true : null; // null: ignored
}

// The switches of a URL query (a string such as '?fx=off&dof=on' or a
// URLSearchParams). Unknown names and values are ignored.
export function parseFxSwitches(search) {
  const params = typeof search === 'string' || search == null ? new URLSearchParams(search ?? '') : search;
  const result = { ...FX_ALL_ON };
  const all = switchValue(params.get('fx'));
  if (all !== null) for (const key of Object.keys(result)) result[key] = all;
  for (const name of FX_SWITCHES) {
    const value = switchValue(params.get(name));
    if (value !== null) result[name] = value;
  }
  return Object.freeze(result);
}

const fxRows = new Map(); // switches key -> the high row with them applied

// The feature row to use for `row` with the URL `switches` applied. They
// only apply to the high row: a switched-off feature falls back to the
// medium row's value, and the screen effects turn off. rays is not a column
// of the table; the sky reads it from the switches. With every switch on,
// and for every other row, the row comes back unchanged.
export function fxFeatures(row, switches = FX_ALL_ON) {
  if (row !== QUALITY_LEVELS.high) return row;
  const key = Object.keys(FX_ALL_ON).map((name) => (switches[name] === false ? 0 : 1)).join('');
  if (!key.includes('0')) return row; // every switch on: the table row itself
  if (!fxRows.has(key)) {
    const on = (name) => switches[name] !== false;
    const below = QUALITY_LEVELS.medium;
    fxRows.set(key, deepFreeze({
      ...row,
      postEffects: {
        bloom: row.postEffects.bloom && on('bloom'),
        depthOfField: row.postEffects.depthOfField && on('dof'),
        warmGrade: row.postEffects.warmGrade && on('grade'),
        vignette: row.postEffects.vignette && on('grade'),
      },
      wind: on('wind') ? row.wind : below.wind,
      meadowFlowers: on('wind') ? row.meadowFlowers : below.meadowFlowers, // the sway
      shadows: on('shadows') ? row.shadows : below.shadows,
      ground: on('ripples') ? row.ground : below.ground,
    }));
  }
  return fxRows.get(key);
}

// The most live particles any level allows; effect counts are written for it.
export const MAX_PARTICLE_CAP = Math.max(...QUALITY_ORDER.map((level) => QUALITY_LEVELS[level].particleCap));

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

// A known level name for any value: case and spaces are ignored, anything
// else (null, '', 'ultra') is QUALITY_FALLBACK.
export function normalizeQuality(value) {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return Object.hasOwn(QUALITY_LEVELS, name) ? name : QUALITY_FALLBACK;
}

// The feature row of a level; unknown values get the QUALITY_FALLBACK row.
export function qualityFeatures(level) {
  return QUALITY_LEVELS[normalizeQuality(level)];
}

// Share of the full effect particle counts a level spawns (0 to 1).
export function particleScale(features) {
  return features.particleCap / MAX_PARTICLE_CAP;
}

// True on levels whose skill effects are plain slides: the Wind Dash seed
// and a thrown seed glide straight along the ground, with no curve or arc.
export function plainSlides(features) {
  return features.skillEffects === 'simple';
}

// True when the scene behind the lobby and room menus is blurred: on
// levels whose HUD glass is frosted. features is undefined for the 2D
// renderer, which never blurs.
export function blursMenus(features) {
  return (features?.hudFrost.blurPx ?? 0) > 0;
}

// The top-level feature keys whose values differ between two rows, so a
// switch rebuilds only those.
export function changedFeatures(from, to) {
  const changed = [];
  for (const key of Object.keys(to)) {
    if (!from || !sameValue(from[key], to[key])) changed.push(key);
  }
  return changed;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key], b[key]));
}

// localStorage, or null where there is none or reading it throws (some
// browsers throw for blocked storage). The game works without it.
export function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// The saved level, or null when nothing (valid) is saved or storage fails.
export function loadSavedQuality(storage) {
  try {
    const saved = storage?.getItem(QUALITY_STORAGE_KEY);
    return typeof saved === 'string' && Object.hasOwn(QUALITY_LEVELS, saved) ? saved : null;
  } catch {
    return null;
  }
}

// Saves a level; returns false when storage is missing or throws (full,
// private mode, blocked).
export function saveQuality(storage, level) {
  try {
    if (!storage) return false;
    storage.setItem(QUALITY_STORAGE_KEY, normalizeQuality(level));
    return true;
  } catch {
    return false;
  }
}

// The level to start with: ?quality= from the URL when given (unknown
// values become QUALITY_FALLBACK), else the saved choice, else
// QUALITY_FALLBACK. fromUrl is true when the URL chose it.
export function startQuality(urlValue, storage) {
  if (urlValue !== null && urlValue !== undefined) return { level: normalizeQuality(urlValue), fromUrl: true };
  return { level: loadSavedQuality(storage) ?? QUALITY_FALLBACK, fromUrl: false };
}

function indexOf(level) {
  const i = QUALITY_ORDER.indexOf(level);
  if (i < 0) throw new Error(`Unknown quality level: ${level}`);
  return i;
}

// The Q key: high -> medium -> low -> high.
export function cycleQuality(level) {
  return QUALITY_ORDER[(indexOf(level) + 1) % QUALITY_ORDER.length];
}

// One level lower; low stays low.
export function lowerQuality(level) {
  return QUALITY_ORDER[Math.min(indexOf(level) + 1, QUALITY_ORDER.length - 1)];
}

// Pixel ratio for the renderer: the screen's, capped at the level's pixelRatioCap.
export function cappedPixelRatio(devicePixelRatio, cap) {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(ratio, cap);
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
