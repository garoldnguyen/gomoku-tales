// Tuning data of the forest sprites (docs/art-direction-v3-1.md section
// 6.1): assets/forest-meta.json, kept apart from assets/v3-meta.json, adds
// what the manifest does not say, keyed by manifest name: the anchor pixel
// (ground point) of a tree or undergrowth frame, the looks of the
// undergrowth sheet, the tiling of the wall strips, a kind and a note.
// Pure: no DOM or Three.js, so it runs under node --test. A missing or bad
// file, or a bad field, only warns; the defaults below (the numbers of the
// section 6.1 table) are used instead.

import { fetchJsonFile } from '../render/assets.js';
import { ART } from './art-assets.js';

export const FOREST_META_URL = 'assets/forest-meta.json';

const F = ART.v3.forest;

// The undergrowth looks in frame order (section 6.1).
export const UNDERGROWTH_LOOKS = Object.freeze([
  'fern', 'fern small', 'shrub', 'shrub with berries', 'shrub with flowers', 'tall grass', 'sapling', 'log', 'stump',
]);

// Used for any key or field the file lacks or gets wrong. The wall strips
// stand on their bottom edge, so they have no anchor.
export const DEFAULT_FOREST_META = Object.freeze({
  [F.pine]: { anchor: [16, 62] },
  [F.oak]: { anchor: [28, 56] },
  [F.birch]: { anchor: [15, 56] },
  [F.poplar]: { anchor: [11, 68] },
  [F.undergrowth]: { anchor: [14, 21], looks: UNDERGROWTH_LOOKS },
  [F.wallRound]: { tile: 'repeat-x' },
  [F.wallPine]: { tile: 'repeat-x' },
});

const isWhole = (n) => Number.isInteger(n) && n >= 0;

// One check per field: true if `value` is usable.
const FIELDS = {
  anchor: (v) => Array.isArray(v) && v.length === 2 && v.every(isWhole),
  looks: (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s !== ''),
  tile: (v) => v === 'repeat-x' || v === 'repeat-y',
  kind: (v) => typeof v === 'string' && v !== '',
  note: (v) => typeof v === 'string',
};

// Checks the parsed file and returns { [name]: { field: value } } with the
// defaults filled in. Bad fields and unknown fields are dropped with a
// warning. Never throws.
export function parseForestMeta(raw, { warn = () => {} } = {}) {
  const meta = {};
  for (const [name, entry] of Object.entries(DEFAULT_FOREST_META)) meta[name] = { ...entry };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warn('forest tuning data is not an object, using the defaults');
    return meta;
  }
  for (const [name, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      warn(`forest tuning data for "${name}" is not an object, ignored`);
      continue;
    }
    const fields = { ...meta[name] };
    for (const [field, value] of Object.entries(entry)) {
      if (!FIELDS[field]) warn(`forest tuning data "${name}" has an unknown field "${field}", ignored`);
      else if (!FIELDS[field](value)) warn(`forest tuning data "${name}" has a bad "${field}", using the default`);
      else fields[field] = value;
    }
    meta[name] = fields;
  }
  return meta;
}

// Loads and checks assets/forest-meta.json. Never rejects: a missing or
// broken file warns and gives the defaults.
export async function loadForestMeta({ url = FOREST_META_URL, fetchJson = fetchJsonFile, warn = () => {} } = {}) {
  let raw;
  try {
    raw = await fetchJson(url);
  } catch (error) {
    warn(`forest tuning data not loaded, using the defaults: ${error.message}`);
    return parseForestMeta({});
  }
  return parseForestMeta(raw, { warn });
}

// The v3 tuning data (parseV3Meta) with the forest entries added, so the
// readers of v3-meta.js (metaAnchor, tileMode) work on the forest sheets
// too. The two files name different sheets.
export function withForestMeta(v3Meta, forestMeta) {
  return { ...v3Meta, ...forestMeta };
}
