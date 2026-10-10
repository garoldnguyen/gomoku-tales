// Tuning data of the Farmland v3 art pack (docs/art-direction-v3.md
// sections 2 to 4): assets/v3-meta.json adds what the manifest does not
// say, keyed by manifest name: the anchor pixel of a sprite, the start time
// of each plant growth stage, the looks (one frame each) of a flower sheet,
// the tiling of a strip and the cell layout of the board texture.
// Pure: no DOM or Three.js, so it runs under node --test. A missing or bad
// file, or a bad field, only warns; the defaults below are used instead.

import { fetchJsonFile } from '../render/assets.js';

export const V3_META_URL = 'assets/v3-meta.json';

// Plant growth stages, frame index = stage (section 4).
export const PLANT_STAGES = ['drop', 'land', 'sprout', 'open', 'rest'];

const PLANT_DEFAULT = { anchor: [18, 36], stageStartMs: [0, 150, 450, 850, 1200] };
// The mossy boulder (rock-v3, 32 by 32, rows 7 to 30): anchored so its base stands on the same ground line as the plants,
// so a petrified plant becomes a rock that sits right on its plot.
const ROCK_DEFAULT = { anchor: [16, 27] };
const BOARD_DEFAULT = { cell: 32, gutter: 2, plot: 30 };

// Used for any key or field the file lacks or gets wrong.
export const DEFAULT_V3_META = {
  'plant-x': PLANT_DEFAULT,
  'plant-o': PLANT_DEFAULT,
  'rock-v3': ROCK_DEFAULT,
  'farm-board': BOARD_DEFAULT,
  'farm-board-low': BOARD_DEFAULT,
};

const isWhole = (n) => Number.isInteger(n) && n >= 0;

// One check per field: true if `value` is usable.
const FIELDS = {
  anchor: (v) => Array.isArray(v) && v.length === 2 && v.every(isWhole),
  stageStartMs: (v) => Array.isArray(v) && v.length === PLANT_STAGES.length && v[0] === 0
    && v.every((t, i) => Number.isFinite(t) && (i === 0 || t > v[i - 1])),
  looks: (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s !== ''),
  kinds: (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s !== ''),
  tile: (v) => v === 'repeat-x' || v === 'repeat-y',
  cell: (v) => isWhole(v) && v > 0,
  gutter: isWhole,
  plot: (v) => isWhole(v) && v > 0,
  note: (v) => typeof v === 'string',
};

// Checks the parsed file and returns { [name]: { field: value } } with the
// defaults filled in. Bad fields and unknown fields are dropped with a
// warning. Never throws.
export function parseV3Meta(raw, { warn = () => {} } = {}) {
  const meta = {};
  for (const [name, entry] of Object.entries(DEFAULT_V3_META)) meta[name] = { ...entry };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warn('v3 tuning data is not an object, using the defaults');
    return meta;
  }
  for (const [name, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      warn(`v3 tuning data for "${name}" is not an object, ignored`);
      continue;
    }
    const fields = { ...meta[name] };
    for (const [field, value] of Object.entries(entry)) {
      if (!FIELDS[field]) warn(`v3 tuning data "${name}" has an unknown field "${field}", ignored`);
      else if (!FIELDS[field](value)) warn(`v3 tuning data "${name}" has a bad "${field}", using the default`);
      else fields[field] = value;
    }
    meta[name] = fields;
  }
  return meta;
}

// Loads and checks assets/v3-meta.json. Never rejects: a missing or broken
// file warns and gives the defaults.
export async function loadV3Meta({ url = V3_META_URL, fetchJson = fetchJsonFile, warn = () => {} } = {}) {
  let raw;
  try {
    raw = await fetchJson(url);
  } catch (error) {
    warn(`v3 tuning data not loaded, using the defaults: ${error.message}`);
    return parseV3Meta({});
  }
  return parseV3Meta(raw, { warn });
}

// Readers. `meta` is a result of parseV3Meta.

// The anchor pixel { x, y } of a sprite frame, or null if it has none
// (then the sprite stands on its bottom centre).
export function metaAnchor(meta, name) {
  const anchor = meta[name]?.anchor;
  return anchor ? { x: anchor[0], y: anchor[1] } : null;
}

// Start time in ms of each growth stage of a plant, ascending from 0.
export function stageStartMs(meta, name) {
  return meta[name]?.stageStartMs ?? PLANT_DEFAULT.stageStartMs;
}

// The looks of a flower sheet in frame order, [] if it has none.
export function flowerLooks(meta, name) {
  return meta[name]?.looks ?? [];
}

// The kinds of the wind-bits sheet in frame order, [] if it has none.
export function bitKinds(meta, name) {
  return meta[name]?.kinds ?? [];
}

// 'repeat-x', 'repeat-y' or null.
export function tileMode(meta, name) {
  return meta[name]?.tile ?? null;
}

// { cell, gutter, plot } in art pixels of a board texture.
export function boardCells(meta, name) {
  const { cell, gutter, plot } = { ...BOARD_DEFAULT, ...meta[name] };
  return { cell, gutter, plot };
}
