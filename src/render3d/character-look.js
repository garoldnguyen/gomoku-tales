// The look of each character on the farm: the colour of its marks and the
// effect that plays when its seat plants a seed. The colour belongs to the
// character, the shape belongs to the side: X is always the four-petal cross
// bloom and O always the round bloom, whatever the character. Pure data and
// plans: no DOM or Three.js imports, so it runs under node --test. The
// quality level only enters through its particleCap; nothing here tests a
// level name.

import {
  DANDELION_PUFF_DRIFT, DANDELION_PUFF_MAX, DANDELION_PUFF_MIN, DANDELION_PUFF_MS, DANDELION_PUFF_STAGGER_MS,
  DANDELION_STREAK_COUNT, DANDELION_STREAK_MS, DANDELION_STREAK_STAGGER_MS, FEATHER_DRIFT, FEATHER_MAX, FEATHER_MIN, FEATHER_MS,
  FEATHER_RISE, FEATHER_STAGGER_MS, SOIL_CHIP_MAX, SOIL_CHIP_MIN, SOIL_CHIP_MS, SOIL_SPECK_COUNT,
  SOIL_SPECK_MS, SOIL_THROW_HEIGHT, SOIL_THROW_JITTER_MS, SOIL_THROW_RADIUS, VINE_COIL_MS, VINE_COIL_RADIUS, VINE_COIL_TURNS,
  SWIRL_HEIGHT, SWIRL_MS, SWIRL_PUFF_COUNT, SWIRL_RADIUS, SWIRL_STAGGER_MS, SWIRL_TURN, VINE_LEAF_COUNT, VINE_RISE_MS, VINE_SINK_MS,
} from '../config.js';
import { CLOUD_EAGLE, DEFAULT_SIDES, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../logic/characters.js';
import { O, X } from '../logic/board.js';
import { qualityFeatures } from './quality.js';
import { seededRandom } from './seeded-random.js';
import { WIND_GROUND } from './wind.js';

export const WIND_DANDELION = 'windDandelion';
export const SOIL_BURST = 'soilBurst';
export const VINE_COIL = 'vineCoil';
export const CLOUD_SWIRL = 'cloudSwirl';

// One colour and one placement effect per character.
export const CHARACTER_LOOK = Object.freeze({
  [WIND_RABBIT]: Object.freeze({ colour: '#3b8cff', effect: WIND_DANDELION }), // blue
  [EARTH_BEAR]: Object.freeze({ colour: '#c9703a', effect: SOIL_BURST }), // ochre red
  [JADE_SERPENT]: Object.freeze({ colour: '#2fbf7a', effect: VINE_COIL }), // jade green
  [CLOUD_EAGLE]: Object.freeze({ colour: '#fff2a8', effect: CLOUD_SWIRL }), // pale yellow
});

// The shape stays with the side, never with the character.
export const SIDE_SHAPE = Object.freeze({ [X]: 'cross', [O]: 'round' });

// The colour and the effect id of a character; null for an unknown id.
export function markLookFor(characterId) {
  return Object.hasOwn(CHARACTER_LOOK, characterId) ? CHARACTER_LOOK[characterId] : null;
}

// The mark colour of a seat of the character select (src/logic/seats.js):
// the colour of the character that seat picked, or null before it picked.
export function seatColour(seats, seat) {
  return markLookFor(seats?.picks?.[seat] ?? null)?.colour ?? null;
}

// The mark colour of a side of the game: the colour of the character that
// plays `player` (state.characters, the sides of the seats by pick order,
// seatSides in seats.js; DEFAULT_SIDES when there are none). A side whose
// character has no look keeps the colour its art is drawn in.
export function sideColour(sides, player) {
  return markLookFor((sides ?? DEFAULT_SIDES)[player])?.colour ?? MARK_SOURCE[player].main;
}

// The placement effect id of the character that plays `player`, or null.
export function sideEffect(sides, player) {
  return markLookFor((sides ?? DEFAULT_SIDES)[player])?.effect ?? null;
}

// One cue per planted seed in `events` (a list of logic events, oldest
// first): { x, y, player, effect } with the placement effect of the
// character that plays the seed's side. Seeds moved or converted by a
// skill are not placements and get none.
export function placementCues(events, sides) {
  const cues = [];
  for (const event of events) {
    if (event.type !== 'stonePlaced') continue;
    const effect = sideEffect(sides, event.player);
    if (effect) cues.push({ x: event.x, y: event.y, player: event.player, effect });
  }
  return cues;
}

// --- Tinting the marks ---
//
// The mark art is drawn in the colours of a side: the X art (plant-x,
// decal-last-x) in blue #3b8cff with its shades, the O art (plant-o,
// decal-last-o) in red #ff4b5c with its shades. A tint swaps that source
// colour for the colour of the side's character, and each shade for the
// same shade of that colour (shadeFor), with paletteSwap. The one-colour
// marks of the player to move are tinted the same way: the gold hover
// ring and the white selection decal. The outline and every other colour
// stay as they are.
export const MARK_SOURCE = Object.freeze({
  [X]: Object.freeze({ main: '#3b8cff', shades: Object.freeze(['#2f63b0', '#9ccaff', '#6fb7f0', '#e6f3ff']) }),
  [O]: Object.freeze({ main: '#ff4b5c', shades: Object.freeze(['#a8304a', '#7a2236', '#5e1a2c', '#ffa8b4', '#ffc2cc', '#ffe3e7']) }),
});
export const HOVER_SOURCE = '#ffe14d'; // decal-hover-v3, gold
export const SELECT_SOURCES = Object.freeze(['#f4f7fb', '#ffffff']); // decal-select-v3 and its placeholder, white

const lightness = ([r, g, b]) => (r + g + b) / 3;

// The colour that is to `targetRgb` what `shadeRgb` is to `mainRgb`: a
// lighter shade mixes the target toward white, a darker one toward black,
// by how far the shade is from the main colour in lightness.
export function shadeFor(mainRgb, shadeRgb, targetRgb) {
  const main = lightness(mainRgb);
  const shade = lightness(shadeRgb);
  if (shade >= main) {
    const t = main >= 255 ? 0 : (shade - main) / (255 - main);
    return targetRgb.map((c) => Math.round(c + (255 - c) * t));
  }
  const t = main <= 0 ? 0 : (main - shade) / main;
  return targetRgb.map((c) => Math.round(c * (1 - t)));
}

// The [fromRgb, toRgb] swaps that tint art drawn in `mainHex` (with the
// shades `shadeHexes`) to `targetHex`. None when the target is the main
// colour: that art already has it.
export function tintPairs(mainHex, shadeHexes, targetHex) {
  const main = hexToRgb(mainHex);
  const target = hexToRgb(targetHex);
  if (main.every((c, i) => c === target[i])) return [];
  return [[main, target], ...shadeHexes.map((hex) => [hexToRgb(hex), shadeFor(main, hexToRgb(hex), target)])];
}

// A copy of RGBA `pixels` with every swap of `pairs` applied by
// paletteSwap. Each swap reads the original pixels, so a swapped colour is
// never swapped again by a later pair.
export function tintPixels(pixels, pairs) {
  const out = new pixels.constructor(pixels);
  for (const [from, to] of pairs) {
    const swapped = paletteSwap(pixels, from, to);
    for (let i = 0; i + 3 < out.length; i += 4) {
      if (swapped[i] !== pixels[i] || swapped[i + 1] !== pixels[i + 1] || swapped[i + 2] !== pixels[i + 2]) {
        out[i] = swapped[i];
        out[i + 1] = swapped[i + 1];
        out[i + 2] = swapped[i + 2];
      }
    }
  }
  return out;
}

// '#3b8cff' -> [59, 140, 255].
export function hexToRgb(hex) {
  const value = parseInt(String(hex).replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// A copy of RGBA `pixels` (a Uint8ClampedArray or similar, 4 bytes a pixel)
// with every pixel of exactly the colour `fromRgb` changed to `toRgb`. Other
// pixels and every alpha byte stay as they are.
export function paletteSwap(pixels, fromRgb, toRgb) {
  const out = new pixels.constructor(pixels);
  const [fr, fg, fb] = fromRgb;
  const [tr, tg, tb] = toRgb;
  for (let i = 0; i + 3 < out.length; i += 4) {
    if (out[i] === fr && out[i + 1] === fg && out[i + 2] === fb) {
      out[i] = tr;
      out[i + 1] = tg;
      out[i + 2] = tb;
    }
  }
  return out;
}

// --- Placement plans ---
//
// placementPlan(effectId, { features, seed }) is a frozen list of steps, in
// world units relative to the plot centre (x right, y up, z toward the
// viewer) and in ms from the moment the seed is planted:
//   { kind, particle, startMs, durationMs, from: [x, y, z], to: [x, y, z], ... }
// Steps with particle: true each draw one live particle; a plan never holds
// more of them than features.particleCap. Each plan is built once per
// (effect, cap, seed) and the same frozen list is handed out after that.

export const PLAN_SEED = 20261005;
const EMPTY_PLAN = Object.freeze([]);
const plans = new Map();

export function placementPlan(effectId, options = {}) {
  const features = options.features ?? qualityFeatures();
  const cap = Math.max(0, Math.floor(features.particleCap ?? 0));
  const seed = options.seed ?? PLAN_SEED;
  const build = BUILDERS[effectId];
  if (!build) return EMPTY_PLAN;
  const key = `${effectId}|${cap}|${seed}`;
  let plan = plans.get(key);
  if (!plan) {
    plan = Object.freeze(build(seededRandom(seed), cap).map(freezeStep));
    plans.set(key, plan);
  }
  return plan;
}

// How many particle steps of a plan there are.
export function particleCount(plan) {
  let count = 0;
  for (const step of plan) if (step.particle) count++;
  return count;
}

function freezeStep(step) {
  if (step.from) Object.freeze(step.from);
  if (step.to) Object.freeze(step.to);
  return Object.freeze(step);
}

function between(random, min, max) {
  return min + random() * (max - min);
}

// The main particles (puffs, chips) come first; the cap then cuts the extras.
function split(cap, main, extra) {
  const mainCount = Math.min(cap, main);
  return [mainCount, Math.min(cap - mainCount, extra)];
}

// Wind streaks and 6 to 8 dandelion seed puffs drifting toward the lower right.
function windDandelion(random, cap) {
  const wanted = DANDELION_PUFF_MIN + Math.floor(random() * (DANDELION_PUFF_MAX - DANDELION_PUFF_MIN + 1));
  const [puffs, streaks] = split(cap, wanted, DANDELION_STREAK_COUNT);
  const steps = [];
  for (let i = 0; i < streaks; i++) {
    const across = (i - (streaks - 1) / 2) * 0.25;
    const startX = -0.6 - 0.2 * random();
    const startZ = -0.3 + across;
    steps.push({
      kind: 'windStreak', particle: true, startMs: Math.round(i * DANDELION_STREAK_STAGGER_MS * random()), durationMs: DANDELION_STREAK_MS,
      from: [startX, between(random, 0.3, 0.7), startZ],
      to: [startX + 1.4 * WIND_GROUND.x, between(random, 0.3, 0.7), startZ + 1.4 * WIND_GROUND.z],
      curve: between(random, 0.1, 0.25),
    });
  }
  for (let i = 0; i < puffs; i++) {
    const fromX = between(random, -0.15, 0.15);
    const fromZ = between(random, -0.15, 0.15);
    const drift = DANDELION_PUFF_DRIFT * between(random, 0.7, 1);
    steps.push({
      kind: 'dandelionPuff', particle: true, startMs: i * DANDELION_PUFF_STAGGER_MS, durationMs: DANDELION_PUFF_MS,
      from: [fromX, between(random, 0.2, 0.4), fromZ],
      to: [fromX + drift * WIND_GROUND.x, between(random, 0.6, 1.0), fromZ + drift * WIND_GROUND.z],
      spin: between(random, -1, 1),
    });
  }
  return steps;
}

// Soil specks and 4 to 6 rock chips thrown out of the plot, falling back.
function soilBurst(random, cap) {
  const wanted = SOIL_CHIP_MIN + Math.floor(random() * (SOIL_CHIP_MAX - SOIL_CHIP_MIN + 1));
  const [chips, specks] = split(cap, wanted, SOIL_SPECK_COUNT);
  const steps = [];
  const throwOut = (kind, index, count, durationMs, height) => {
    const angle = ((index + random() * 0.6) / count) * Math.PI * 2;
    const reach = SOIL_THROW_RADIUS * between(random, 0.5, 1);
    steps.push({
      kind, particle: true, startMs: Math.round(random() * SOIL_THROW_JITTER_MS), durationMs,
      from: [0, 0.05, 0],
      to: [Math.cos(angle) * reach, 0, Math.sin(angle) * reach],
      height: height * between(random, 0.6, 1),
    });
  };
  for (let i = 0; i < chips; i++) throwOut('rockChip', i, chips, SOIL_CHIP_MS, SOIL_THROW_HEIGHT);
  for (let i = 0; i < specks; i++) throwOut('soilSpeck', i, specks, SOIL_SPECK_MS, SOIL_THROW_HEIGHT * 0.6);
  return steps;
}

// A vine rises from the plot, coils twice around the plant and sinks back into
// the soil: VINE_RISE_MS + VINE_COIL_MS + VINE_SINK_MS (1.2 s). The vine
// itself is one mesh, not a particle, so it plays on every level; the leaf
// flecks it sheds while coiling are particles.
function vineCoil(random, cap) {
  const coilStart = VINE_RISE_MS;
  const sinkStart = VINE_RISE_MS + VINE_COIL_MS;
  const steps = [
    { kind: 'vineRise', particle: false, startMs: 0, durationMs: VINE_RISE_MS, from: [VINE_COIL_RADIUS, -0.1, 0], to: [VINE_COIL_RADIUS, 0.2, 0] },
    {
      kind: 'vineCoil', particle: false, startMs: coilStart, durationMs: VINE_COIL_MS,
      from: [VINE_COIL_RADIUS, 0.2, 0], to: [VINE_COIL_RADIUS, 0.8, 0], turns: VINE_COIL_TURNS, radius: VINE_COIL_RADIUS,
    },
    { kind: 'vineSink', particle: false, startMs: sinkStart, durationMs: VINE_SINK_MS, from: [VINE_COIL_RADIUS, 0.8, 0], to: [0, -0.1, 0] },
  ];
  const leaves = Math.min(cap, VINE_LEAF_COUNT);
  for (let i = 0; i < leaves; i++) {
    const angle = ((i + random() * 0.5) / Math.max(1, leaves)) * Math.PI * 2 * VINE_COIL_TURNS;
    const height = 0.2 + 0.6 * (i + 0.5) / Math.max(1, leaves);
    steps.push({
      kind: 'vineLeaf', particle: true, startMs: coilStart + Math.round((i + 0.5) * VINE_COIL_MS / Math.max(1, leaves)),
      durationMs: sinkStart + VINE_SINK_MS - coilStart - Math.round((i + 0.5) * VINE_COIL_MS / Math.max(1, leaves)),
      from: [Math.cos(angle) * VINE_COIL_RADIUS, height, Math.sin(angle) * VINE_COIL_RADIUS],
      to: [Math.cos(angle) * VINE_COIL_RADIUS * 1.6, 0, Math.sin(angle) * VINE_COIL_RADIUS * 1.6],
    });
  }
  return steps;
}

// A soft cloud swirl over the plot: SWIRL_PUFF_COUNT puffs circle part of
// a turn round it and dissolve, and 3 to 5 white feathers rise and
// dissolve, drifting with the wind. The puffs come first; the cap then cuts
// the feathers.
function cloudSwirl(random, cap) {
  const wanted = FEATHER_MIN + Math.floor(random() * (FEATHER_MAX - FEATHER_MIN + 1));
  const [puffs, feathers] = split(cap, SWIRL_PUFF_COUNT, wanted);
  const steps = [];
  for (let i = 0; i < puffs; i++) {
    const angle = (i / Math.max(1, puffs)) * Math.PI * 2 + random() * 0.4;
    const end = angle + SWIRL_TURN * Math.PI * 2;
    const height = SWIRL_HEIGHT * between(random, 0.85, 1.15);
    steps.push({
      kind: 'cloudPuff', particle: true, startMs: i * SWIRL_STAGGER_MS, durationMs: SWIRL_MS,
      from: [Math.cos(angle) * SWIRL_RADIUS, height, Math.sin(angle) * SWIRL_RADIUS],
      to: [Math.cos(end) * SWIRL_RADIUS, height, Math.sin(end) * SWIRL_RADIUS],
    });
  }
  for (let i = 0; i < feathers; i++) {
    const fromX = between(random, -0.2, 0.2);
    const fromZ = between(random, -0.2, 0.2);
    const drift = FEATHER_DRIFT * between(random, 0.6, 1);
    steps.push({
      kind: 'feather', particle: true, startMs: i * FEATHER_STAGGER_MS, durationMs: FEATHER_MS,
      from: [fromX, between(random, 0.25, 0.4), fromZ],
      to: [fromX + drift * WIND_GROUND.x, between(random, 0.25, 0.4) + FEATHER_RISE * between(random, 0.8, 1), fromZ + drift * WIND_GROUND.z],
      spin: between(random, -1, 1),
    });
  }
  return steps;
}

const BUILDERS = Object.freeze({
  [WIND_DANDELION]: windDandelion, [SOIL_BURST]: soilBurst, [VINE_COIL]: vineCoil, [CLOUD_SWIRL]: cloudSwirl,
});

// The full length of a plan in ms.
export function planDurationMs(plan) {
  let end = 0;
  for (const step of plan) end = Math.max(end, step.startMs + step.durationMs);
  return end;
}
