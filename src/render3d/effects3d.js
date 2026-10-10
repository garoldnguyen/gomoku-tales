// Skill visuals and placement effects on the farm
// (docs/art-direction-v3.md sections 4 and 9). Everything is started by
// the events returned by src/logic (see effect-plans.js visualsForEvents)
// and never changes the rules:
//   planted seed      nothing at once: the piece layer (world-renderer.js)
//                     grows the plant and calls soilPuff on Land (High)
//                     and openSparkles on Open (Medium and High)
//   Wind Dash         petals circle the source plant (decal-select-v3) and
//                     red brackets (decal-dash-target-v3) mark the target;
//                     when it resolves the source bloom folds back into a
//                     seed (its stages in reverse at 2.5 times speed), the
//                     seed rides a short gust of petals along a curve to the
//                     target, the marks fade as it lands and the plant
//                     regrows there from Land
//   Tornado Zone      the caster sees the cross (decal-zone-cross) with faint
//                     blue petals drifting over its cells, drawn from the
//                     viewer's state; the plants inside bend towards it
//                     (High); the other seat sees nothing on the board. When
//                     the trap fires the cross is revealed as a whirlwind that
//                     spins the seed up and throws it to its neighbour plot
//                     in an arc; it lands with a small dust puff and regrows
//                     from Land
//   Petrification     earth energy winds round the enemy plant, its colour
//                     drains to grey (it flickers first), it shatters and a
//                     mossy rock pops in where it stood with dust rising and
//                     a light camera shake (High only, the only shake); the
//                     rock then stays
//   Mud Trap          the puddle is a flat decal drawn from state.mud (and
//                     under a sunk seed, from state.sunk) that spreads out
//                     when it forms and bubbles; a seed planted in it sinks
//                     and goes dim, and when it surfaces or the puddle dries
//                     the cracked crust shows and fades while the sprout
//                     pops up (mud-effects.js, world-renderer.js)
//   Venom             sap drops fall from the sky onto the target plant, which
//                     droops a little and stays; the zone's empty plots show
//                     withered purple soil (poison-plot.png) drawn from the
//                     viewer's state, with low fog and toxic bubbles hugging
//                     the ground, and thin away when it ends (poison-effects.js,
//                     world-renderer.js); nothing is drawn on a covered plot
//   placement         the placement effect of the character whose side
//                     planted the seed (placement(), character-look.js):
//                     Wind Rabbit's dandelion wind, Earth Bear's soil
//                     burst, Jade Serpent's vine coil, Cloud Eagle's cloud
//                     swirl with rising white feathers
//   convert           the plant wilts back to Sprout, a small spark runs
//                     through the soil and a plant of the other team regrows
//                     from Land (no event starts it any more)
//   plans             the burst particles of the Free Action effects are the
//                     frozen plans of skill-plans.js, built once per event
//                     and played step by step (placement-runs.js)
//   skill banners     HUD text on the 2D canvas over the world
// The always-on wind petals belong to the scenery (sky-scene.js). A plant
// that regrows from Land is grown by the piece layer: the effects hold its
// cell hidden while the flying seed (or the wilting old plant) shows, and
// call options.regrow(x, y, player, plantedAt) so it enters Land just as
// the hold ends (effect-plans.js heldCell and regrowCell).
//
// Quality (quality.js): every level shows the marks, the folds, the
// flights and regrowth; on plainSlides levels (Low) the flying seeds slide
// straight along the ground instead of curving and arcing; particles are scaled by particleScale (none on Low, a
// few on Medium, all on High) and capped by particleCap; only the
// skillEffects 'full' level bends the plants towards a Tornado Zone, and
// only the rockShake growth extra shakes the camera.
//
// Kept cheap: all particles share one fixed-size pool (particle-pool.js)
// drawn as one Points draw call, flying seeds and rocks are pooled sprites
// and the decals are made once. The per-frame update allocates nothing:
// particles spawn through one reused parameter object, they take their
// random numbers from a typed array filled by an integer generator
// (seeded-random.js effectRandom), and per-frame numbers are shared
// through the `frame` object rather than passed between functions, so the
// JS engine never boxes them.
//
// While a flying copy of a plant is on its way to a cell, holds(cellIndex,
// time) is true and the piece layer hides the real plant there.

import * as THREE from 'three';
import {
  BANNER_3D_Y, BOARD_SIZE, CAMERA_FOV, CAST_RING_DOTS, CAST_RING_FROM, CAST_RING_MS, CAST_RING_TO, CAST_SPARKLES,
  CELL_SIZE, CLOUD_PUFFS, CONVERT_SPARK_RATE, COVER_CLEAR_MARGIN, DASH_SWIRL_RATE, DASH_TRAIL_RATE, HISS_MIST, HISS_RING_DOTS,
  HISS_RING_GAP_MS, HISS_RING_MS, HISS_RING_TO, HISS_RINGS, HISS_WOBBLE, HISS_WOBBLE_WAVES, MARK_FADE_MS,
  PLACE_DUST_COUNT, PLACEMENT_SLOTS, PLANT_OPEN_SPARKLES, PX_WORLD, RING_DOT_PX, RING_LIGHTEN, RING_MAX_DOTS, RING_SLOTS,
  DASH_GHOST_OPACITY, DASH_WIND_RATE, DASH_WIND_SPEED, PETRIFY_GLOW, PETRIFY_WRAP_MS, SHAKE3D_LIGHT, SKILL_RUN_SLOTS, SOIL_PUFF_MAX,
  SOIL_PUFF_MIN, SOIL_PUFF_MS, SPRITE_STRETCH_Y, STORM_MS, THROW_ARC_HEIGHT, TORNADO_BEND_PX,
  TORNADO_ARM, VINE_POINT_PX, VINE_POINTS, WIN_RING_DOTS,
  WIN_RING_MS, WIN_RING_TO, WIN_SPARKLES, WIN_STAGGER_MS,
} from '../config.js';
import { O, X } from '../logic/board.js';
import { DEFAULT_SIDES } from '../logic/characters.js';
import { cloudBox } from '../logic/cloud.js';
import { createBanners } from '../render/effects.js';
import { createMudEffects } from './mud-effects.js';
import { createPoisonEffects } from './poison-effects.js';
import { artMeta, artSource } from './art.js';
import { ART } from './art-assets.js';
import { CHARACTER_LOOK, PLAN_SEED, placementPlan } from './character-look.js';
import {
  catchUpVisuals, convertPose, dashCurveInto, dashPose, heldCell, PETRIFY_STAGE_ROCK, petrifyPose, regrowCell,
  shakeLeft, shakeOffset3d, shakeStrength, sparkPathInto, throwPose, visualsForEvents, zoneVisible,
} from './effect-plans.js';
import { STAGE_DROP, STAGE_REST } from './growth.js';
import {
  createParticlePool, createSpawnParams, emit, scaledCount, SHAPE_PLUS, SHAPE_SQUARE,
} from './particle-pool.js';
import { cellIndexAt, cellToWorld, cellToWorldInto } from './picking.js';
import { clearPlacementRuns, createPlacementRuns, startPlacementRun, stepPlacementRuns, stopRunsAt, vinePointsInto } from './placement-runs.js';
import { GLOW } from './post-processing.js';
import { MAX_PARTICLE_CAP, particleScale, plainSlides } from './quality.js';
import { effectRandom } from './seeded-random.js';
import { clearRings, createRings, ringDotsInto, startRing, stepRings, stopRingsAt } from './skill-rings.js';
import {
  CROSS_PETAL_COLOURS, mudDryPlan, mudFormPlan, petrifyPlan, poisonEndPlan, seedSinkPlan, seedSurfacePlan, SKILL_PLAN_SEED, STEP_LOOKS,
  stormPlan, tornadoCrossPlan, venomPlan,
} from './skill-plans.js';
import { stageStartMs } from './v3-meta.js';
import { createCellDecal, createPieceSprite, decalMaterial, placeOnCell, zonePieceGeometry } from './world.js';

const COLORS = {
  bloomGoldX: 0xffd84a, // Open sparkles of an X bloom
  bloomPinkO: 0xff9cc8, // and of an O bloom
  soil: 0x8a5a3c, // the pack's soil colours
  soilMid: 0x6b4430,
  soilDark: 0x5d3a2a,
  pebble: 0x9a948a,
  pebbleDark: 0x6e6a62,
  leaf: 0x6cc04a,
  leafDark: 0x4fa044,
  spark: 0xffe14d, // gold
  glow: 0xfff6c0,
  windStreak: 0xeaf6ff, // windDandelion: the pale wind streaks
  dandelion: 0xfff6ec, // and the seed puffs
  vine: 0x2fbf7a, // vineCoil: the jade vine
  vineDark: 0x1f8a57,
  cloudPuff: 0xf4f8ff, // cloudSwirl: the soft cloud puffs
  feather: 0xffffff, // and the white feathers
  petrifyGlow: 0xffd070, // the gold earth energy a wrapped plant glows with (emissive)
  white: 0xffffff,
};
// The petals of wind-bits: pink, white, yellow, lilac.
const PETALS = [0xffb8d4, 0xfff6ec, 0xffe066, 0xcdb0f0];
const SOILS = [COLORS.soil, COLORS.soilMid, COLORS.soilDark];

const PX = PX_WORLD; // particle sizes are in art pixels, like the sprites
const SPARK_GLOW = 0.7; // emissive intensity of the wilted plant while the spark passes
const TIMELINE_SLOTS = 16; // skill animations running at once before more records are made
const MAX_STEP_MS = 100; // a hidden tab does not make the effects jump on return
const TWO_PI = Math.PI * 2;
const BLOOM_ROW_PX = 12; // art pixel row of a plant frame where the bloom opens
const ZONE_CELLS = 4 * TORNADO_ARM + 1; // most cells a Tornado Zone cross has: the centre and each arm
const STORM_FADE_IN_MS = 120; // the revealed cross shows this fast
const BOARD_MIDDLE = (BOARD_SIZE - 1) / 2; // the middle cell of the field, where Hiss rings start
const RING_Y = 0.05; // world height of the ring dots, just over the plots

// The colour of each character as a number (CHARACTER_LOOK), for the
// twinkles of its skills, and the lighter one of its ring dots.
const CHARACTER_COLOUR = Object.fromEntries(Object.entries(CHARACTER_LOOK).map(([id, look]) => [id, parseInt(look.colour.slice(1), 16)]));
const RING_COLOUR = Object.fromEntries(Object.entries(CHARACTER_COLOUR).map(([id, colour]) => [id, towardWhite(colour, RING_LIGHTEN)]));

// `colour` (0xRRGGBB) mixed `share` of the way toward white.
export function towardWhite(colour, share) {
  const mix = (c) => Math.round(c + (255 - c) * share);
  return (mix(colour >> 16) << 16) | (mix((colour >> 8) & 0xff) << 8) | mix(colour & 0xff);
}

// The stage start times of the plant of `player` (v3-meta.json).
function plantStages(player) {
  return stageStartMs(artMeta(), ART.v3.plant[player] ?? ART.v3.plant[X]);
}

// Builds the effects on `world` (world.js). Call trigger() with the events
// of each applied action (catchUp() for events that piled up while the
// page was hidden), update(time) every frame before world.render(),
// drawBanner(ctx, time) after the HUD, and reset() for a new game.
// options.regrow(x, y, player, plantedAt) makes the piece layer grow the
// plant on cell (x, y) as if its seed was planted at `plantedAt`.
export function createEffects3d(world, { regrow = () => {} } = {}) {
  const fx = {
    world,
    pool: createParticlePool(MAX_PARTICLE_CAP),
    sp: createSpawnParams(),
    // Every emitter calls random.fill(u) per particle and reads u[0],
    // u[1], ... in [0, 1). For looks only; it never touches the game.
    random: effectRandom(0x2545f491),
    u: new Float64Array(12),
    // This frame's numbers: time (ms), dtS (seconds since the last frame),
    // scale (particle scale of the quality level), pointScale (particle
    // world size to screen pixels at depth 1). last is NaN until the first
    // frame.
    frame: { last: NaN, time: 0.5, dtS: 0.5, scale: 1, pointScale: 1.5, plain: false },
  };
  const { pool, sp, random, u, frame } = fx;

  const points = createParticlePoints(MAX_PARTICLE_CAP);
  world.scene.add(points.mesh);
  const banners = createBanners();
  const actors = createActorPool(world);
  // The placement effects playing (placement-runs.js), and the vines of
  // Jade Serpent's vine coil: one Points draw call of their own, outside
  // the particle cap (the vine plays on every level), rebuilt every frame
  // from the runs.
  const placements = createPlacementRuns(PLACEMENT_SLOTS);
  // The plans of the Free Action effects playing (skill-plans.js), in runs of
  // their own so they never take a seed placement's slot.
  const skillRuns = createPlacementRuns(SKILL_RUN_SLOTS);
  const vinePool = createParticlePool(VINE_POINTS * PLACEMENT_SLOTS);
  const vinePoints = createParticlePoints(vinePool.capacity);
  world.scene.add(vinePoints.mesh);
  const vineXyz = new Float32Array(VINE_POINTS * 3);
  // The ring waves (skill-rings.js): one Points draw call of their own,
  // outside the particle cap (rings play on every level), rebuilt every
  // frame from the playing rings.
  const rings = createRings(RING_SLOTS);
  const ringPool = createParticlePool(RING_SLOTS * RING_MAX_DOTS);
  const ringPoints = createParticlePoints(ringPool.capacity);
  world.scene.add(ringPoints.mesh);
  const ringXyz = new Float32Array(RING_MAX_DOTS * 3);
  // The colour of the character on each side (CHARACTER_COLOUR), set by
  // trigger() from the sides of the game the events come from.
  const sideColour = { [X]: CHARACTER_COLOUR[DEFAULT_SIDES[X]], [O]: CHARACTER_COLOUR[DEFAULT_SIDES[O]] };
  const sideRing = { [X]: RING_COLOUR[DEFAULT_SIDES[X]], [O]: RING_COLOUR[DEFAULT_SIDES[O]] };
  const ringAt = { x: 0, z: 0, y: RING_Y, from: 0, to: 0, ms: 0, dots: 0, color: 0, delay: 0, wobble: 0, waves: 0 };
  const held = new Float64Array(BOARD_SIZE * BOARD_SIZE); // cell index -> time its plant shows again
  let covered = new Uint8Array(BOARD_SIZE * BOARD_SIZE); // cell index -> 1 while the viewer's state covers the plot (setCovered)
  let coveredNow = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
  const timelines = [];
  for (let i = 0; i < TIMELINE_SLOTS; i++) timelines.push(newTimeline());
  const dashMark = createDashMark(fx, actors);
  const swirl = createTornadoSwirl(fx);
  const stormCross = createStormCross(fx);
  const mud = createMudEffects(fx);
  const poison = createPoisonEffects(fx);
  // The camera shake: when it started and how strong it is; shakeOffset3d
  // reads ageMs and strength and writes the offset x and y.
  const shake = { start: -Infinity, ageMs: 0.5, strength: 0.5, x: 0.5, y: 0.5 };
  // The pose functions read ageMs (and progress, spark) and write the pose here.
  const pose = {
    ageMs: 0.5, frame: 0, done: false, flying: false, progress: 0.5, spark: 0.5, x: 0.5, z: 0.5, lift: 0.5,
    spinScale: 0.5, dropPx: 0.5, height: 0.5, up: 0.5, stage: 0, grey: 0, scaleX: 0.5, scaleY: 0.5,
  };
  const at = { x: 0.5, y: 0.5, z: 0.5 }; // where a trail is left this frame
  const cellAt = { x: 0.5, z: 0.5 }; // a cell centre, for the growth cues
  const pointScaleFactor = 1 / (2 * Math.tan((CAMERA_FOV * Math.PI) / 360));

  // --- Particle bursts ---

  // PLANT_OPEN_SPARKLES gold (X) or pink (O) twinkles around an opening
  // bloom whose frame stands `bloomY` world units up at (wx, wz). Not
  // scaled by the level; the particle cap still applies.
  function bloomSparkles(wx, wz, bloomY, player) {
    const tint = player === X ? COLORS.bloomGoldX : COLORS.bloomPinkO;
    for (let i = 0; i < PLANT_OPEN_SPARKLES; i++) {
      random.fill(u);
      const angle = ((i + 0.5) / PLANT_OPEN_SPARKLES) * TWO_PI + u[0] * 0.4;
      const speed = 0.35 + u[1] * 0.25;
      sp.x = wx + Math.cos(angle) * 0.15;
      sp.y = bloomY + u[2] * 0.1;
      sp.z = wz + Math.sin(angle) * 0.15;
      sp.vx = Math.cos(angle) * speed;
      sp.vy = 0.5 + u[3] * 0.4;
      sp.vz = Math.sin(angle) * speed;
      sp.gravity = 1.2;
      sp.drag = 2;
      sp.life = 0.45 + u[4] * 0.15;
      sp.size = 3 * PX;
      sp.grow = 0;
      sp.color = tint;
      sp.alpha = 1;
      sp.shape = SHAPE_PLUS;
      pool.spawnFall(sp);
    }
  }

  // SOIL_PUFF_MIN to SOIL_PUFF_MAX soil pixels flying outward from a
  // landing seed and falling back within SOIL_PUFF_MS.
  function soilPixels(wx, wz) {
    random.fill(u);
    const count = SOIL_PUFF_MIN + Math.floor(u[0] * (SOIL_PUFF_MAX - SOIL_PUFF_MIN + 1));
    const lifeS = SOIL_PUFF_MS / 1000;
    for (let i = 0; i < count; i++) {
      random.fill(u);
      const angle = (i / count) * TWO_PI + u[0] * 0.6;
      const speed = 0.5 + u[1] * 0.4;
      sp.x = wx;
      sp.y = 0.04;
      sp.z = wz;
      sp.vx = Math.cos(angle) * speed;
      sp.vy = 0.9 + u[2] * 0.5;
      sp.vz = Math.sin(angle) * speed;
      sp.gravity = 8;
      sp.drag = 0.5;
      sp.life = lifeS * (0.8 + u[3] * 0.2);
      sp.size = 2 * PX;
      sp.grow = 0;
      sp.color = i % 2 ? COLORS.soil : COLORS.soilDark;
      sp.alpha = 1;
      sp.shape = SHAPE_SQUARE;
      pool.spawnFall(sp);
    }
  }

  // A soil puff: soft clumps of earth thrown up around (wx, wz) that hang
  // a moment and settle, scaled by the level.
  function soilPuff(wx, wz, base, speedScale) {
    const count = scaledCount(base, frame.scale);
    for (let i = 0; i < count; i++) {
      random.fill(u);
      const angle = (i / count) * TWO_PI + u[0] * 0.6;
      const speed = (0.5 + u[1] * 0.6) * speedScale;
      sp.x = wx + Math.cos(angle) * 0.2;
      sp.y = 0.06;
      sp.z = wz + Math.sin(angle) * 0.2;
      sp.vx = Math.cos(angle) * speed;
      sp.vy = 0.5 + u[2] * 0.5;
      sp.vz = Math.sin(angle) * speed;
      sp.gravity = 2.5;
      sp.drag = 3;
      sp.life = 0.4 + u[3] * 0.15;
      sp.size = (2 + u[4] * 2) * PX;
      sp.grow = PX;
      sp.color = SOILS[i % 3];
      sp.alpha = 0.9;
      sp.shape = SHAPE_SQUARE;
      pool.spawnFall(sp);
    }
  }

  // Petals and the odd leaf whirling round a cell (a thrown plant with
  // nowhere to go, a dash that failed, a seed taking off).
  function petalGust(wx, wz, base) {
    const count = scaledCount(base, frame.scale);
    for (let i = 0; i < count; i++) {
      random.fill(u);
      sp.x = wx;
      sp.y = 0.05 + u[0] * 0.25;
      sp.z = wz;
      sp.radius = 0.3 + u[1] * 0.2;
      sp.angle = u[2] * TWO_PI;
      sp.spin = 7;
      sp.rise = 0.5;
      sp.widen = 0.4;
      sp.life = 0.4 + u[3] * 0.2;
      sp.size = (2 + u[4]) * PX;
      sp.grow = 0;
      sp.color = i % 5 === 4 ? COLORS.leaf : PETALS[i & 3];
      sp.alpha = 0.9;
      sp.shape = SHAPE_SQUARE;
      pool.spawnSpiral(sp);
    }
  }

  // The gust of petals a flying seed rides, left behind it at `at`.
  function petalTrail(count, alpha) {
    for (let i = 0; i < count; i++) {
      random.fill(u);
      sp.x = at.x - 0.12 + u[0] * 0.24;
      sp.y = at.y - 0.08 + u[1] * 0.2;
      sp.z = at.z - 0.12 + u[2] * 0.24;
      sp.vx = -0.2 + u[3] * 0.4;
      sp.vy = u[4] * 0.25;
      sp.vz = -0.2 + u[5] * 0.4;
      sp.gravity = 0.4;
      sp.drag = 2;
      sp.life = 0.35 + u[6] * 0.2;
      sp.size = (2 + u[7]) * PX;
      sp.grow = 0;
      sp.color = u[8] < 0.12 ? COLORS.leaf : PETALS[Math.floor(u[9] * 4)];
      sp.alpha = alpha;
      sp.shape = SHAPE_SQUARE;
      pool.spawnFall(sp);
    }
  }

  // The dandelion fluff a plant blown by the storm trails behind it at
  // `at`: white seed puffs (plus-shaped) that drift up and away on the wind.
  function fluffTrail(count) {
    for (let i = 0; i < count; i++) {
      random.fill(u);
      sp.x = at.x - 0.1 + u[0] * 0.2;
      sp.y = at.y - 0.05 + u[1] * 0.15;
      sp.z = at.z - 0.1 + u[2] * 0.2;
      sp.vx = 0.15 + u[3] * 0.35; // with the wind: towards the lower right
      sp.vy = 0.1 + u[4] * 0.3;
      sp.vz = 0.1 + u[5] * 0.3;
      sp.gravity = -0.05; // fluff floats
      sp.drag = 1.2;
      sp.life = 0.7 + u[6] * 0.5;
      sp.size = (2 + u[7] * 1.5) * PX;
      sp.grow = 0.4;
      sp.color = u[8] < 0.2 ? PETALS[2] : COLORS.dandelion;
      sp.alpha = 0.9;
      sp.shape = u[9] < 0.7 ? SHAPE_PLUS : SHAPE_SQUARE;
      pool.spawnFall(sp);
    }
  }

  // The conversion spark's twinkles left in the soil at `at`.
  function sparkTrail(count) {
    for (let i = 0; i < count; i++) {
      random.fill(u);
      sp.x = at.x - 0.03 + u[0] * 0.06;
      sp.y = 0.02;
      sp.z = at.z - 0.03 + u[1] * 0.06;
      sp.vx = 0;
      sp.vy = 0.15 + u[2] * 0.2;
      sp.vz = 0;
      sp.gravity = 0;
      sp.drag = 3;
      sp.life = 0.22 + u[3] * 0.12;
      sp.size = (2 + u[4]) * PX;
      sp.grow = -PX;
      sp.color = i % 2 ? COLORS.glow : COLORS.spark;
      sp.alpha = 1;
      sp.shape = i % 2 ? SHAPE_SQUARE : SHAPE_PLUS;
      pool.spawnFall(sp);
    }
  }

  // A new shake replaces the current one only if it is stronger than what
  // is left of it. Only levels with the rockShake growth extra shake.
  function startShake(strength) {
    if (!world.features.growthExtras.rockShake) return;
    if (strength > 0 && shakeLeft(frame.time - shake.start, shake.strength) < strength) {
      shake.start = frame.time;
      shake.strength = strength;
    }
  }

  // A sprite moved to a point between the timeline's two cells.
  function moveAlong(record, actor, progress) {
    at.x = record.fx + (record.tx - record.fx) * progress;
    at.z = record.fz + (record.tz - record.fz) * progress;
    actor.sprite.object.position.x = at.x;
    actor.sprite.object.position.z = at.z;
  }

  // --- Skill rings and the twinkles of every character ---

  // A ring of dots spreading from (wx, wz) (skill-rings.js startRing).
  function ring(wx, wz, from, to, ms, dots, color, delay) {
    ringAt.x = wx;
    ringAt.z = wz;
    ringAt.from = from;
    ringAt.to = to;
    ringAt.ms = ms;
    ringAt.dots = dots;
    ringAt.color = color;
    ringAt.delay = delay;
    ringAt.wobble = 0;
    ringAt.waves = 0;
    return startRing(rings, ringAt, frame.time);
  }

  // `base` twinkles in `color` bursting up and out of the plot at (wx, wz),
  // with the odd white one, scaled by the level.
  function colourSparkles(wx, wz, base, color, rise) {
    const count = scaledCount(base, frame.scale);
    for (let i = 0; i < count; i++) {
      random.fill(u);
      const angle = (i / count) * TWO_PI + u[0] * 0.5;
      const speed = 0.4 + u[1] * 0.5;
      sp.x = wx + Math.cos(angle) * 0.2;
      sp.y = 0.1 + u[2] * 0.2;
      sp.z = wz + Math.sin(angle) * 0.2;
      sp.vx = Math.cos(angle) * speed;
      sp.vy = rise + u[3] * 0.6;
      sp.vz = Math.sin(angle) * speed;
      sp.gravity = 1.4;
      sp.drag = 1.8;
      sp.life = 0.5 + u[4] * 0.3;
      sp.size = (2 + u[5]) * PX;
      sp.grow = 0;
      sp.color = i % 4 === 3 ? COLORS.white : color;
      sp.alpha = 1;
      sp.shape = i % 2 ? SHAPE_SQUARE : SHAPE_PLUS;
      pool.spawnFall(sp);
    }
  }

  // Hiss: jade mist puffs rising here and there off the field.
  function hissMist(color) {
    const count = scaledCount(HISS_MIST, frame.scale);
    for (let i = 0; i < count; i++) {
      random.fill(u);
      cellToWorldInto(Math.floor(u[0] * BOARD_SIZE), Math.floor(u[1] * BOARD_SIZE), cellAt);
      sp.x = cellAt.x;
      sp.y = 0.05;
      sp.z = cellAt.z;
      sp.vx = 0.1 + u[2] * 0.1; // drifting with the wind, to the lower right
      sp.vy = 0.3 + u[3] * 0.3;
      sp.vz = 0.05 + u[4] * 0.05;
      sp.gravity = 0;
      sp.drag = 0.6;
      sp.life = 0.8 + u[5] * 0.5;
      sp.size = (3 + u[6] * 2) * PX;
      sp.grow = 3 * PX;
      sp.color = i % 3 === 2 ? COLORS.white : color;
      sp.alpha = 0.45;
      sp.shape = SHAPE_SQUARE;
      pool.spawnFall(sp);
    }
  }

  // Cloud Eagle's cloud over the cells it covers (the cloud whose chosen
  // cell is (cx, cy), clipped to the field; the 4 by 4 cloud has no centre
  // cell, so the puffs are spread over the middle of the covered cells, not
  // the chosen one): puffs rolling in on the wind from the upper left
  // (forming), or drifting off to the lower right and swelling as they thin
  // (fading).
  function cloudPuffs(cx, cy, forming) {
    const box = cloudBox({ x: cx, y: cy }, BOARD_SIZE);
    cellToWorldInto((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, cellAt);
    const wx = cellAt.x;
    const wz = cellAt.z;
    const halfX = (box.x1 - box.x0 + 1) / 2; // half the covered width and height, in cells
    const halfZ = (box.y1 - box.y0 + 1) / 2;
    const count = scaledCount(CLOUD_PUFFS, frame.scale);
    for (let i = 0; i < count; i++) {
      random.fill(u);
      const ox = (u[0] * 2 - 1) * halfX;
      const oz = (u[1] * 2 - 1) * halfZ;
      if (forming) {
        // From up to 1.5 world units up the wind, gliding into the area.
        sp.x = wx + ox - 1.2 - u[2] * 0.6;
        sp.z = wz + oz - 0.45 - u[2] * 0.2;
        sp.vx = 1.6 + u[3] * 0.6;
        sp.vz = 0.55 + u[3] * 0.2;
        sp.drag = 2.2;
      } else {
        sp.x = wx + ox;
        sp.z = wz + oz;
        sp.vx = 0.5 + u[3] * 0.4;
        sp.vz = 0.18 + u[3] * 0.14;
        sp.drag = 0.4;
      }
      sp.y = 0.35 + u[4] * 0.3;
      sp.vy = forming ? 0 : 0.12 + u[5] * 0.12;
      sp.gravity = 0;
      sp.life = 0.6 + u[6] * 0.4;
      sp.size = (4 + u[7] * 3) * PX;
      sp.grow = (forming ? 1 : 4) * PX;
      sp.color = u[8] < 0.75 ? COLORS.cloudPuff : COLORS.white;
      sp.alpha = 0.7;
      sp.shape = SHAPE_SQUARE;
      pool.spawnFall(sp);
    }
  }

  // The playing rings, as dots in their colour fading out (ringDotsInto).
  function drawRings() {
    ringPool.clear();
    stepRings(rings, frame.time);
    for (let r = 0; r < rings.length; r++) {
      const record = rings[r];
      if (!record.active) continue;
      const n = ringDotsInto(record, frame.time, ringXyz);
      for (let i = 0; i < n; i++) {
        sp.x = ringXyz[i * 3];
        sp.y = ringXyz[i * 3 + 1];
        sp.z = ringXyz[i * 3 + 2];
        sp.vx = 0;
        sp.vy = 0;
        sp.vz = 0;
        sp.gravity = 0;
        sp.drag = 0;
        sp.life = 1;
        sp.size = RING_DOT_PX * PX;
        sp.grow = 0;
        sp.color = i % 5 === 4 ? COLORS.white : record.color;
        sp.alpha = record.alpha;
        sp.shape = SHAPE_SQUARE;
        const k = ringPool.spawnFall(sp);
        // Halfway through its life a dot shows at its full alpha (alphaAt).
        if (k >= 0) ringPool.age[k] = 0.5;
      }
    }
    ringPoints.sync(ringPool, frame);
  }

  // --- Placement effects ---

  // One particle step of a placement plan (character-look.js) on the plot
  // of `run`: it flies from `from` to `to` over its duration, along an arc
  // `height` (or `curve`) high when it has one. Called once per step by
  // stepPlacementRuns; the vine steps are drawn by drawVines instead.
  function spawnPlanStep(step, run) {
    if (!step.particle) return;
    const look = STEP_LOOKS[step.kind];
    if (look) {
      spawnLookStep(step, run, look);
      return;
    }
    const durS = step.durationMs / 1000;
    const { from, to } = step;
    const arc = step.height ?? step.curve ?? 0;
    sp.x = run.x + from[0];
    sp.y = from[1];
    sp.z = run.z + from[2];
    sp.vx = (to[0] - from[0]) / durS;
    sp.vz = (to[2] - from[2]) / durS;
    // Up and back down `arc` above the straight line in durS.
    sp.vy = (to[1] - from[1]) / durS + (4 * arc) / durS;
    sp.gravity = (8 * arc) / (durS * durS);
    sp.drag = 0;
    sp.life = durS;
    sp.grow = 0;
    sp.alpha = 1;
    sp.shape = SHAPE_SQUARE;
    switch (step.kind) {
      case 'windStreak':
        sp.size = 2 * PX;
        sp.color = COLORS.windStreak;
        sp.alpha = 0.7;
        break;
      case 'dandelionPuff':
        sp.size = 2 * PX;
        sp.color = COLORS.dandelion;
        sp.shape = SHAPE_PLUS;
        break;
      case 'rockChip':
        sp.size = 3 * PX;
        sp.color = step.startMs % 2 ? COLORS.pebble : COLORS.pebbleDark;
        break;
      case 'soilSpeck':
        sp.size = 2 * PX;
        sp.color = step.startMs % 2 ? COLORS.soil : COLORS.soilDark;
        break;
      case 'vineLeaf':
        sp.size = 2 * PX;
        sp.color = COLORS.leaf;
        break;
      case 'cloudPuff':
        sp.size = 4 * PX;
        sp.grow = 3 * PX; // it swells as it dissolves
        sp.color = COLORS.cloudPuff;
        sp.alpha = 0.75;
        break;
      case 'feather':
        sp.size = 2 * PX;
        sp.color = COLORS.feather;
        sp.shape = SHAPE_PLUS;
        break;
      default:
        return;
    }
    pool.spawnFall(sp);
  }

  // One step of a Free Action plan on a plot run (runPlan): left out when the
  // plot it starts over is covered for the viewer NOW, whatever plot the run
  // started on and whatever the viewer's state was when it started. A run only
  // stops with its own plot (clearPlot), so a cloud that covers another plot of
  // a zone cast or of the zone ending leaves the rest of the plan playing on
  // the plots that stay visible; the steps of a plan stay over their plot.
  function spawnSkillStep(step, run) {
    if (step.particle) {
      const i = cellIndexAt(run.x + step.from[0], run.z + step.from[2]);
      if (i >= 0 && covered[i] === 1) return;
    }
    spawnPlanStep(step, run);
  }

  // One particle of a Free Action plan (skill-plans.js): its size, colour and
  // shape come from the step's look; it flies from `from` to `to` over its
  // duration (an arc `height` high when it has one) or, for a spiral step,
  // circles the ground point under `from` while it rises.
  function spawnLookStep(step, run, look) {
    const durS = step.durationMs / 1000;
    const { from, to } = step;
    sp.life = durS;
    sp.size = look.sizePx * PX;
    sp.grow = look.growPx * PX;
    sp.color = look.colours[step.tone];
    sp.alpha = look.alpha;
    sp.shape = look.plus ? SHAPE_PLUS : SHAPE_SQUARE;
    if (step.spiral) {
      sp.x = run.x + from[0];
      sp.y = from[1];
      sp.z = run.z + from[2];
      sp.radius = step.radius;
      sp.angle = step.angle;
      sp.spin = step.spin;
      sp.rise = step.rise;
      sp.widen = step.widen;
      pool.spawnSpiral(sp);
      return;
    }
    sp.x = run.x + from[0];
    sp.y = from[1];
    sp.z = run.z + from[2];
    sp.vx = (to[0] - from[0]) / durS;
    sp.vz = (to[2] - from[2]) / durS;
    sp.vy = (to[1] - from[1]) / durS + (4 * step.height) / durS;
    sp.gravity = (8 * step.height) / (durS * durS);
    sp.drag = 0;
    pool.spawnFall(sp);
  }

  // The vines of the playing vine coils, as still jade dots (vinePointsInto).
  function drawVines() {
    vinePool.clear();
    for (let r = 0; r < placements.length; r++) {
      const run = placements[r];
      if (!run.active || !run.vine) continue;
      const n = vinePointsInto(run.plan, frame.time - run.start, vineXyz);
      for (let i = 0; i < n; i++) {
        sp.x = run.x + vineXyz[i * 3];
        sp.y = vineXyz[i * 3 + 1];
        sp.z = run.z + vineXyz[i * 3 + 2];
        sp.vx = 0;
        sp.vy = 0;
        sp.vz = 0;
        sp.gravity = 0;
        sp.drag = 0;
        sp.life = 1;
        sp.size = VINE_POINT_PX * PX;
        sp.grow = 0;
        sp.color = i % 4 === 3 ? COLORS.vineDark : COLORS.vine;
        sp.alpha = 1;
        sp.shape = SHAPE_SQUARE;
        const k = vinePool.spawnFall(sp);
        // Halfway through its life a dot shows at full alpha (alphaAt).
        if (k >= 0) vinePool.age[k] = 0.5;
      }
    }
    vinePoints.sync(vinePool, frame);
  }

  // --- Skill animations with flying seeds, rocks and wilting plants ---

  function startTimeline(kind, from, to, stages) {
    let record = timelines.find((t) => !t.active);
    if (!record) {
      record = newTimeline();
      timelines.push(record);
    }
    const a = cellToWorld(from.x, from.y);
    const b = cellToWorld(to.x, to.y);
    Object.assign(record, {
      active: true, kind, start: frame.time, fx: a.x, fz: a.z, tx: b.x, tz: b.z, stages, landed: false, carry: 0,
      fromCell: from.y * BOARD_SIZE + from.x, toCell: to.y * BOARD_SIZE + to.x,
    });
    return record;
  }

  function endTimeline(record) {
    if (record.a) actors.release(record.a);
    if (record.b) actors.release(record.b);
    if (record.c) actors.release(record.c);
    record.a = null;
    record.b = null;
    record.c = null;
    record.active = false;
  }

  // One frame of a running skill animation.
  function stepTimeline(record) {
    pose.ageMs = frame.time - record.start;
    const { a, b, c } = record;
    switch (record.kind) {
      case 'dashStreak':
        dashPose(pose, record.stages);
        a.sprite.setFrame(pose.frame);
        if (pose.flying) {
          if (!record.landed) {
            record.landed = true; // here: the seed has taken off
            petalGust(record.fx, record.fz, 8);
          }
          dashCurveInto(pose, record.fx, record.fz, record.tx, record.tz, frame.plain);
          a.sprite.object.position.x = pose.x;
          a.sprite.object.position.z = pose.z;
          a.sprite.plane.position.y = pose.lift;
          a.setShadow(1 - pose.lift);
          at.x = pose.x;
          at.y = 0.15 + pose.lift;
          at.z = pose.z;
          petalTrail(emit(record, DASH_TRAIL_RATE * frame.scale, frame.dtS), 0.9);
        }
        if (pose.done) {
          soilPuff(record.tx, record.tz, PLACE_DUST_COUNT, 0.8);
          dashMark.end();
          endTimeline(record);
        }
        break;
      case 'throw':
        // The whirlwind spins the seed up off its plot (pose.lift, turning
        // round), then throws it: it comes down from that height as it flies.
        throwPose(pose, frame.plain);
        a.sprite.setFrame(STAGE_DROP);
        moveAlong(record, a, pose.progress);
        pose.up = pose.lift * (1 - pose.progress) + pose.height; // world units above its plot now
        a.sprite.plane.position.y = pose.dropPx * PX * SPRITE_STRETCH_Y + pose.up;
        a.sprite.plane.scale.x = pose.spinScale;
        a.setShadow(Math.max(0.4, 1 - (0.5 * pose.up) / THROW_ARC_HEIGHT));
        if (pose.lift > 0 || pose.progress > 0) {
          at.y = 0.15 + pose.up;
          fluffTrail(emit(record, DASH_TRAIL_RATE * 0.6 * frame.scale, frame.dtS));
        }
        if (pose.done) {
          soilPuff(record.tx, record.tz, PLACE_DUST_COUNT, 1.3);
          endTimeline(record);
        }
        break;
      case 'petrify':
        // The victim's plant (a) glows with the earth energy and flickers to
        // its grey copy (b), which shatters; the rock (c) pops in where it was.
        petrifyPose(pose);
        if (pose.stage === PETRIFY_STAGE_ROCK) {
          if (!record.landed) {
            record.landed = true;
            a.sprite.object.visible = false;
            b.sprite.object.visible = false;
            c.sprite.object.visible = true;
            startShake(shakeStrength(record));
            soilPuff(record.tx, record.tz, PLACE_DUST_COUNT, 1.4);
          }
          c.sprite.plane.scale.set(pose.scaleX, pose.scaleY, 1);
        } else {
          a.sprite.object.visible = pose.grey !== 1;
          b.sprite.object.visible = pose.grey === 1;
          a.material.emissiveIntensity = PETRIFY_GLOW * Math.min(1, pose.ageMs / PETRIFY_WRAP_MS);
          a.sprite.plane.scale.set(pose.scaleX, pose.scaleY, 1);
          b.sprite.plane.scale.set(pose.scaleX, pose.scaleY, 1);
        }
        if (pose.done) endTimeline(record);
        break;
      case 'winPop':
        // One winning plant's turn in the celebration: it starts `carry` ms
        // after the win (its place in the line).
        if (pose.ageMs < record.carry) break;
        colourSparkles(record.tx, record.tz, WIN_SPARKLES, record.color, 1.1);
        petalGust(record.tx, record.tz, 4);
        endTimeline(record);
        break;
      case 'convert':
        convertPose(pose, record.stages);
        a.sprite.setFrame(pose.frame);
        if (pose.spark >= 0) {
          // The wilted sprout lights up as the spark reaches it.
          a.material.emissiveIntensity = SPARK_GLOW * pose.spark;
          sparkPathInto(pose, record.tx, record.tz);
          at.x = pose.x;
          at.z = pose.z;
          sparkTrail(emit(record, CONVERT_SPARK_RATE * frame.scale, frame.dtS));
        }
        if (pose.done) {
          soilPuff(record.tx, record.tz, PLACE_DUST_COUNT / 2, 0.6);
          endTimeline(record);
        }
        break;
    }
  }

  // The options of the plan of an event on the plot of `spec`: this level's
  // particle cap and a seed that varies by plot.
  function planOptions(spec) {
    return { features: world.features, seed: SKILL_PLAN_SEED + spec.y * BOARD_SIZE + spec.x };
  }

  // Plays `plan` (skill-plans.js) on the plot (x, y), each step once.
  function runPlan(plan, x, y) {
    cellToWorldInto(x, y, cellAt);
    startPlacementRun(skillRuns, plan, cellAt.x, cellAt.z, frame.time);
  }

  // Venom (event poisonPlaced): sap drops fall onto the target plant (x, y),
  // which droops a little and stays, and the plots of the zone turn withered
  // under fog and bubbles (poison-effects.js draws the zone itself from the
  // viewer's state). The event is public, so what the viewer may not see is
  // left out here: nothing names a plot that is covered for the viewer.
  function startVenom(spec) {
    const target = spec.y * BOARD_SIZE + spec.x;
    const targetShown = covered[target] === 0;
    poison.form();
    if (targetShown) poison.wiltPlot(target);
    const cells = [];
    for (const cell of spec.cells) {
      const i = cell.y * BOARD_SIZE + cell.x;
      if (covered[i] === 1 || i === target) continue;
      cells.push(cell);
    }
    runPlan(venomPlan({ x: spec.x, y: spec.y, cells, target: targetShown }, planOptions(spec)), spec.x, spec.y);
  }

  // Venom (event poisonEnded): the plots the zone showed on the last frame
  // thin away (poison-effects.js) and fog lifts off the ones with no target.
  function endPoison() {
    const count = poison.end();
    const cells = [];
    for (let k = 0; k < count; k++) {
      if (poison.fadeCentre[k] === 0) cells.push({ x: poison.fadeX[k], y: poison.fadeY[k] });
    }
    if (cells.length === 0) return;
    const origin = cells[0];
    runPlan(poisonEndPlan({ x: origin.x, y: origin.y, cells }, planOptions(origin)), origin.x, origin.y);
  }

  // The plot (x, y) has just become covered for the viewer (a cloud of the
  // other seat): everything of the effects still playing on it stops at once,
  // so the screen never shows what the cloud hides: the seed placement and
  // skill plans, the rings, the particles over the plot, and every flying or
  // wilting copy that starts or ends on it (Petrification, thrown, converted,
  // poisoned and dashing seeds), with the hold on both of its plots. (Events
  // that name a covered plot are already left out upstream.)
  function clearPlot(x, y) {
    cellToWorldInto(x, y, cellAt);
    const reach = CELL_SIZE / 2 + COVER_CLEAR_MARGIN;
    const i = y * BOARD_SIZE + x;
    stopRunsAt(placements, cellAt.x, cellAt.z);
    stopRunsAt(skillRuns, cellAt.x, cellAt.z);
    stopRingsAt(rings, cellAt.x, cellAt.z);
    pool.removeInBox(cellAt.x - reach, cellAt.z - reach, cellAt.x + reach, cellAt.z + reach);
    for (let k = 0; k < timelines.length; k++) {
      const record = timelines[k];
      if (!record.active || (record.fromCell !== i && record.toCell !== i)) continue;
      held[record.fromCell] = 0;
      held[record.toCell] = 0;
      endTimeline(record);
    }
    held[i] = 0;
    stormCross.hidePlot(i);
    mud.cover(x, y);
    poison.cover(x, y);
  }

  // While a storm shows, the whirlwind may spin over an arm of the cross that
  // is covered for the viewer: its particles over a covered plot go at once,
  // every frame, so the cloud hides it. No allocation.
  function suppressCoveredStorm() {
    const cells = stormCross.cellIndex;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      if (i < 0 || covered[i] === 0) continue;
      const x = i % BOARD_SIZE;
      cellToWorldInto(x, (i - x) / BOARD_SIZE, cellAt);
      const reach = CELL_SIZE / 2;
      pool.removeInBox(cellAt.x - reach, cellAt.z - reach, cellAt.x + reach, cellAt.z + reach);
    }
  }

  function hold(spec, stages) {
    const cell = heldCell(spec, stages);
    if (!cell) return;
    const i = cell.y * BOARD_SIZE + cell.x;
    held[i] = Math.max(held[i], frame.time + cell.ms);
    const grow = regrowCell(spec, stages);
    if (grow) regrow(grow.x, grow.y, grow.player, frame.time + grow.startMs);
  }

  function start(spec) {
    const stages = plantStages(spec.kind === 'convert' ? spec.from : spec.player);
    hold(spec, stages);
    switch (spec.kind) {
      // 'place': the plant grows in the piece layer, which calls the cues below.
      case 'dashMark':
        dashMark.show(spec.from, spec.to, spec.player);
        break;
      case 'dashStreak': {
        dashMark.resolve(); // the marks stay until the seed lands
        const record = startTimeline('dashStreak', spec.from, spec.to, stages);
        record.a = actors.acquire(spec.player, spec.from);
        break;
      }
      case 'dashFizzle': {
        dashMark.end();
        const from = cellToWorld(spec.from.x, spec.from.y);
        const to = cellToWorld(spec.to.x, spec.to.y);
        petalGust(from.x, from.z, 10);
        soilPuff(to.x, to.z, PLACE_DUST_COUNT, 1);
        break;
      }
      case 'tornado':
        swirl.show(spec);
        break;
      case 'storm':
        // The fired trap reveals the cross to everybody as a whirlwind.
        stormCross.show(spec, covered);
        runPlan(stormPlan(spec, planOptions(spec)), spec.x, spec.y);
        startShake(SHAKE3D_LIGHT);
        break;
      case 'tornadoEnd':
        swirl.end();
        break;
      case 'dashClear':
        dashMark.reset();
        break;
      case 'tornadoClear':
        swirl.clear();
        break;
      case 'endLingering':
        swirl.end();
        dashMark.end();
        break;
      case 'throw': {
        const record = startTimeline('throw', spec.from, spec.to, stages);
        record.a = actors.acquire(spec.player, spec.from);
        break;
      }
      case 'throwBlocked': {
        const { x, z } = cellToWorld(spec.x, spec.y);
        petalGust(x, z, 14);
        break;
      }
      case 'petrify': {
        // The plant of the victim (the side the event names), its grey copy
        // and the rock; the board already holds the rock, which the piece
        // layer keeps hidden for petrifyMs (hold).
        const victim = spec.from === X || spec.from === O ? spec.from : spec.player === X ? O : X;
        const record = startTimeline('petrify', spec, spec, stages);
        record.a = actors.acquire(victim, spec);
        record.b = actors.acquire(victim === X ? 'stoneX' : 'stoneO', spec);
        record.c = actors.acquire('rock', spec);
        record.a.material.emissive.setHex(COLORS.petrifyGlow);
        record.b.sprite.object.visible = false;
        record.c.sprite.object.visible = false;
        runPlan(petrifyPlan(planOptions(spec)), spec.x, spec.y);
        break;
      }
      case 'mudForm':
        mud.form(spec.x, spec.y);
        runPlan(mudFormPlan(planOptions(spec)), spec.x, spec.y);
        break;
      case 'seedSink':
        mud.sink(spec.x, spec.y);
        runPlan(seedSinkPlan(planOptions(spec)), spec.x, spec.y);
        break;
      case 'seedSurface':
        mud.surface(spec.x, spec.y);
        runPlan(seedSurfacePlan(planOptions(spec)), spec.x, spec.y);
        break;
      case 'mudDry':
        mud.dry(spec.x, spec.y);
        runPlan(mudDryPlan(planOptions(spec)), spec.x, spec.y);
        break;
      case 'convert': {
        const record = startTimeline('convert', spec, spec, stages);
        record.a = actors.acquire(spec.from, spec);
        break;
      }
      case 'castRing': {
        const color = sideColour[spec.player] ?? COLORS.white;
        cellToWorldInto(spec.x, spec.y, cellAt);
        ring(cellAt.x, cellAt.z, CAST_RING_FROM, CAST_RING_TO, CAST_RING_MS, CAST_RING_DOTS, sideRing[spec.player] ?? color, 0);
        colourSparkles(cellAt.x, cellAt.z, CAST_SPARKLES, color, 0.7);
        break;
      }
      case 'hiss': {
        const color = sideColour[spec.player] ?? COLORS.vine;
        cellToWorldInto(BOARD_MIDDLE, BOARD_MIDDLE, cellAt);
        for (let i = 0; i < HISS_RINGS; i++) {
          const record = ring(cellAt.x, cellAt.z, 0.2, HISS_RING_TO, HISS_RING_MS, HISS_RING_DOTS, sideRing[spec.player] ?? color, i * HISS_RING_GAP_MS);
          record.wobble = HISS_WOBBLE;
          record.waves = HISS_WOBBLE_WAVES;
        }
        hissMist(color);
        break;
      }
      case 'venom':
        startVenom(spec);
        break;
      case 'poisonEnd':
        endPoison(spec);
        break;
      case 'cloudForm':
      case 'cloudFade': {
        cloudPuffs(spec.x, spec.y, spec.kind === 'cloudForm');
        break;
      }
      case 'winBloom': {
        const color = sideColour[spec.player] ?? COLORS.spark;
        for (let i = 0; i < spec.line.length; i++) {
          const cell = spec.line[i];
          const record = startTimeline('winPop', cell, cell, stages);
          record.carry = i * WIN_STAGGER_MS;
          record.color = color;
          ring(record.tx, record.tz, CAST_RING_FROM, WIN_RING_TO, WIN_RING_MS, WIN_RING_DOTS, sideRing[spec.player] ?? color, i * WIN_STAGGER_MS);
        }
        break;
      }
      case 'banner':
        banners.add(spec.text, frame.time);
        break;
    }
  }

  return {
    // Starts the visuals for the events of one applied action at `time`.
    // characters are the sides of the game the events come from
    // (state.characters): the rings and twinkles of a skill take the colour
    // of the character that used it.
    trigger(events, time, characters = DEFAULT_SIDES) {
      frame.time = time;
      frame.scale = particleScale(world.features);
      pool.limit = Math.min(pool.capacity, world.features.particleCap);
      sideColour[X] = CHARACTER_COLOUR[characters[X]] ?? sideColour[X];
      sideColour[O] = CHARACTER_COLOUR[characters[O]] ?? sideColour[O];
      sideRing[X] = RING_COLOUR[characters[X]] ?? sideRing[X];
      sideRing[O] = RING_COLOUR[characters[O]] ?? sideRing[O];
      for (const spec of visualsForEvents(events)) start(spec);
    },

    // Events that piled up while the page was hidden: only the Wind Dash
    // marks and the Tornado Zone are brought up to date (catchUpVisuals).
    catchUp(events, time) {
      frame.time = time;
      for (const spec of catchUpVisuals(events)) start(spec);
    },

    // The Tornado Zone follows what the viewer's state shows, not only the
    // events (a secret zone must be gone from the screen the moment the
    // viewer may no longer see it, and be there when they may): called every
    // drawn frame with the drawn state's zone (null, hidden, or visible
    // with cells). Allocation free; it acts only when something changed. A
    // swirl that is already fading out because its zone ended is left to
    // finish its fade, but only for the seat whose trap it was and for a
    // spectator: the seat that is not its owner (viewer X or O) loses it at
    // once, so the fade of an expired secret cross never shows it.
    syncTornado(zone, viewer) {
      const mark = swirl.centre;
      if (zoneVisible(zone)) {
        if (!mark.active) swirl.show(zone);
      } else if (mark.active && (Number.isNaN(mark.endStart) || ((viewer === X || viewer === O) && viewer !== mark.owner))) {
        swirl.clear();
      }
    },

    // The Open sparkles of the plant of `player` on cell (x, y), on levels
    // with the openSparkles growth extra. anchorY is the art pixel row of
    // the plant frame that stands on the plot centre; the bloom row is that
    // many pixels higher seen from the camera.
    openSparkles(x, y, player, anchorY) {
      if (!world.features.growthExtras.openSparkles) return;
      pool.limit = Math.min(pool.capacity, world.features.particleCap);
      cellToWorldInto(x, y, cellAt);
      bloomSparkles(cellAt.x, cellAt.z, (anchorY - BLOOM_ROW_PX) * PX * SPRITE_STRETCH_Y, player);
    },

    // The placement effect `effectId` (character-look.js) of a seed
    // planted on cell (x, y) at `time`: its plan for this level's particle
    // cap, each step played once.
    placement(x, y, effectId, time) {
      const plan = placementPlan(effectId, { features: world.features, seed: PLAN_SEED + y * BOARD_SIZE + x });
      cellToWorldInto(x, y, cellAt);
      startPlacementRun(placements, plan, cellAt.x, cellAt.z, time);
    },

    // The plants of the flying copies (Wind Dash, a thrown or converted
    // plant) from now on: the tinted sheets of the match by player
    // (mark-tints.js), and their stone grey copies (the Petrification).
    setPlantSheets(sheets, stoneSheets) {
      actors.setPlantSheets(sheets, stoneSheets);
    },

    // The puddles and sunk seeds of the drawn state, for the bubbles on the
    // puddles that stay (null: none). Called every drawn frame.
    setMudState(puddles, seeds) {
      mud.setState(puddles, seeds);
    },

    // The drawn state, for the fog and bubbles on the plots of its Venom zone
    // (poison-effects.js): called every drawn frame, null for none.
    setPoisonState(state) {
      poison.setState(state);
    },

    // How withered the plots of the zone are at `time` (a share of the decal's
    // opacity), and how much of a zone that just ended is left. The thinning
    // zone's plots are poisonFade (fadeX, fadeY, fadeEmpty for fadeCount of them).
    poisonForm(time) {
      return poison.formAmount(time);
    },

    poisonFadeAmount(time) {
      return poison.fadeAmount(time);
    },

    poisonFade: poison,

    // How drooped the plant on plot index i is at `time` (0 to 1): the target
    // of a Venom cast droops a little and perks up again.
    wilt(i, time) {
      return poison.wilt(i, time);
    },

    // The plots the drawn state covers for the viewer ([{ x, y }] of
    // maskForViewer, or null): called every drawn frame, allocation free. A
    // plot that was not covered on the frame before is cleared of the effects
    // still playing on it (clearPlot).
    setCovered(cells) {
      coveredNow.fill(0);
      for (let k = 0; cells && k < cells.length; k++) {
        const i = cells[k].y * BOARD_SIZE + cells[k].x;
        if (!(i >= 0 && i < coveredNow.length)) continue;
        coveredNow[i] = 1;
        if (covered[i] === 0) clearPlot(cells[k].x, cells[k].y);
      }
      const swap = covered;
      covered = coveredNow;
      coveredNow = swap;
    },

    // How big the puddle on (x, y) is at `time`, as a share of its full size
    // (it spreads out when it forms).
    mudSpread(x, y, time) {
      return mud.spread(x, y, time);
    },

    // How far below its plot the plant on plot index i stands at `time`, as a
    // share of the sunk depth (mud-effects.js depth): the piece layer sinks
    // it in and pops it out by this.
    sunkDepth(i, isSunk, time) {
      return mud.depth(i, isSunk, time);
    },

    // The Land soil puff of a seed on cell (x, y), on levels with the
    // soilPuff growth extra.
    soilPuff(x, y) {
      if (!world.features.growthExtras.soilPuff) return;
      pool.limit = Math.min(pool.capacity, world.features.particleCap);
      cellToWorldInto(x, y, cellAt);
      soilPixels(cellAt.x, cellAt.z);
    },

    // True while the plant on cell index `i` (y * BOARD_SIZE + x) is shown
    // arriving by a flying copy, so the real one stays hidden.
    holds(i, time) {
      return held[i] > time;
    },

    // How many art pixels the plant on cell (x, y) bends its top towards
    // the Tornado Zone swirl at bendCentre (x, z in world units) this
    // frame: 0 outside the zone, without a zone, and on levels below
    // skillEffects 'full'.
    bendAt(x, y) {
      return world.features.skillEffects === 'full' ? swirl.bendAt(x, y) : 0;
    },

    bendCentre: swirl.centre,

    // Advances every effect to `time` (ms) and moves the camera for the shake.
    update(time) {
      frame.dtS = Number.isNaN(frame.last) ? 0 : Math.min(Math.max(0, time - frame.last), MAX_STEP_MS) / 1000;
      frame.last = time;
      frame.time = time;
      frame.scale = particleScale(world.features);
      frame.plain = plainSlides(world.features);
      pool.limit = Math.min(pool.capacity, world.features.particleCap);
      frame.pointScale = world.drawingHeight * pointScaleFactor;

      dashMark.update();
      swirl.update();
      stormCross.update();
      mud.update();
      poison.update();
      for (let i = 0; i < timelines.length; i++) {
        if (timelines[i].active) stepTimeline(timelines[i]);
      }
      stepPlacementRuns(placements, time, spawnPlanStep);
      stepPlacementRuns(skillRuns, time, spawnSkillStep);
      drawVines();
      drawRings();

      pool.step(frame);
      if (stormCross.active) suppressCoveredStorm();
      points.sync(pool, frame);

      shake.ageMs = time - shake.start;
      world.setCameraShake(shakeOffset3d(shake));
    },

    // The skill banner on the HUD canvas.
    drawBanner(ctx, time) {
      banners.draw(ctx, time, BANNER_3D_Y);
    },

    // A new game: every effect stops at once.
    reset() {
      for (const record of timelines) if (record.active) endTimeline(record);
      pool.clear();
      points.sync(pool, frame);
      clearPlacementRuns(placements);
      clearPlacementRuns(skillRuns);
      vinePool.clear();
      vinePoints.sync(vinePool, frame);
      clearRings(rings);
      ringPool.clear();
      ringPoints.sync(ringPool, frame);
      dashMark.reset();
      swirl.reset();
      stormCross.reset();
      mud.reset();
      poison.reset();
      held.fill(0);
      banners.clear();
      shake.start = -Infinity;
      shake.x = 0;
      shake.y = 0;
      world.setCameraShake(shake);
    },
  };
}

// A skill animation record, reused. carry is its particle emission
// remainder (particle-pool.js emit); stages are the stage start times of
// its plant; a, b and c are the sprites it animates (a Petrification uses
// all three: the plant, its grey copy and the rock); landed marks a one-off
// moment (the rock popping in, a dashing seed's take-off); fromCell and toCell
// are the plot indices it starts and ends on (clearPlot ends it when either
// becomes covered).
function newTimeline() {
  return {
    active: false, kind: null, start: 0.5, fx: 0.5, fz: 0.5, tx: 0.5, tz: 0.5, fromCell: 0, toCell: 0, stages: null, a: null, b: null, c: null, landed: false, carry: 0.5, color: 0,
  };
}

// Pooled plant and rock sprites ('X', 'O', 'stoneX', 'stoneO' or 'rock') that
// the skill animations fold, fly, drop, squash and light up. 'stoneX' and
// 'stoneO' are the plants in their stone grey (a Petrification). Each has its
// own material with an emissive map set up once, so the glow never rebuilds a
// shader.
function createActorPool(world) {
  const free = { X: [], O: [], stoneX: [], stoneO: [], rock: [] };
  let plantSheets = { X: null, O: null }; // the tinted plant sheets (setPlantSheets), null: the art's own
  let stoneSheets = { X: null, O: null }; // their stone grey copies, null: the plant's own colours

  // The sheet an actor of `kind` is made from, and the kind of piece sprite
  // it is (createPieceSprite takes X or O for a plant, grey or not).
  const sheetOf = (kind) => (kind === 'rock' ? null : kind === 'stoneX' ? stoneSheets.X : kind === 'stoneO' ? stoneSheets.O : plantSheets[kind]);
  const spriteKindOf = (kind) => (kind === 'stoneX' ? X : kind === 'stoneO' ? O : kind);

  function make(kind) {
    const sheet = sheetOf(kind);
    const sprite = world.addSprite(createPieceSprite(spriteKindOf(kind), sheet));
    const material = sprite.plane.material;
    material.emissive.set(COLORS.glow);
    material.emissiveMap = sprite.texture;
    material.emissiveIntensity = 0;
    return {
      kind,
      sheet,
      sprite,
      material,
      setShadow(factor) {
        sprite.setShadowScale(factor);
      },
    };
  }

  return {
    // An actor of `kind` standing on cell { x, y }.
    acquire(kind, cell) {
      const actor = free[kind].pop() ?? make(kind);
      actor.sprite.object.visible = true;
      placeOnCell(actor.sprite, cell.x, cell.y);
      return actor;
    },

    release(actor) {
      const { sprite } = actor;
      sprite.object.visible = false;
      sprite.plane.position.y = 0;
      sprite.plane.scale.set(1, 1, 1);
      actor.setShadow(1);
      actor.material.emissiveIntensity = 0;
      actor.material.emissive.setHex(COLORS.glow); // a Venom or Petrification actor glowed
      if (actor.kind !== 'rock') sprite.setFrame(STAGE_REST);
      if (actor.kind !== 'rock' && actor.sheet !== sheetOf(actor.kind)) dropStaleActor(world, actor);
      else free[actor.kind].push(actor);
    },

    // New plant sheets: the waiting plant actors are freed; one still
    // flying is freed when it lands (release).
    setPlantSheets(sheets, stones = null) {
      plantSheets = sheets;
      stoneSheets = stones ?? stoneSheets;
      for (const kind of ['X', 'O', 'stoneX', 'stoneO']) {
        for (const actor of free[kind]) dropStaleActor(world, actor);
        free[kind].length = 0;
      }
    },
  };
}

// An actor whose plant sheet was re-tinted: out of the world, its sprite's
// own GPU resources freed.
function dropStaleActor(world, actor) {
  world.removeSprite(actor.sprite);
  actor.sprite.dispose();
}

// How far a lingering mark has faded out: 1 while it shows, falling to 0
// over MARK_FADE_MS once it ends.
function markFade(mark, time) {
  return Number.isNaN(mark.endStart) ? 1 : 1 - (time - mark.endStart) / MARK_FADE_MS;
}

// The announced Wind Dash: the chosen-source decal (decal-select-v3) with
// petals circling the source plant, and the pulsing target decal
// (decal-dash-target-v3) on the target plot, from 'dashAnnounced' until the
// dash's seed lands (resolve(), then end()), the dash fails or the game
// ends.
function createDashMark({ world, pool, sp, random, u, frame }, actors) {
  const make = (art, order) => {
    const mesh = createCellDecal(decalMaterial(artSource(art)));
    mesh.renderOrder = order;
    world.scene.add(mesh);
    return mesh;
  };
  const target = make(ART.v3.decal.dashTarget, 4);
  const source = make(ART.v3.decal.select, 5);
  // endStart is NaN while the mark shows; resolving stops the petals while
  // the seed flies; carry is the emission remainder. The
  // wind runs from the source (x, z) to the target (tx, tz): dx, dz is its
  // direction, len its length in world units.
  const mark = {
    active: false, resolving: false, endStart: NaN, x: 0.5, z: 0.5, tx: 0.5, tz: 0.5, dx: 0.5, dz: 0.5, len: 0.5,
    carry: 0.5,
  };
  const windEmitter = { carry: 0.5 }; // the wind's own emission remainder
  // The ghost: a see-through copy of the dashing plant standing on the
  // target plot, so the player sees where it will land.
  let ghost = null;
  let ghostAlphaTest = 0.5; // the plant material's own cut-out level, put back on release

  const dropGhost = () => {
    if (!ghost) return;
    const { material } = ghost;
    material.transparent = false;
    material.opacity = 1;
    material.alphaTest = ghostAlphaTest;
    material.depthWrite = true;
    material.needsUpdate = true;
    actors.release(ghost);
    ghost = null;
  };

  const hide = () => {
    mark.active = false;
    mark.endStart = NaN;
    target.visible = false;
    source.visible = false;
    dropGhost();
  };

  // Only when a dash is announced (an event, never a plain frame).
  function showGhost(player, to) {
    ghost = actors.acquire(player, to);
    const { material } = ghost;
    ghostAlphaTest = material.alphaTest;
    // The cut-out test reads the alpha after the opacity, so a lower one
    // keeps the see-through plant from being cut away.
    material.alphaTest = DASH_GHOST_OPACITY * ghostAlphaTest * 0.5;
    material.transparent = true;
    material.depthWrite = false;
    material.opacity = DASH_GHOST_OPACITY;
    material.emissiveIntensity = 0.35;
    material.needsUpdate = true;
    ghost.setShadow(0.4);
  }

  return {
    show(from, to, player) {
      placeOnCell(target, to.x, to.y);
      placeOnCell(source, from.x, from.y);
      mark.x = source.position.x;
      mark.z = source.position.z;
      mark.tx = target.position.x;
      mark.tz = target.position.z;
      const dx = mark.tx - mark.x;
      const dz = mark.tz - mark.z;
      mark.len = Math.max(1e-6, Math.hypot(dx, dz));
      mark.dx = dx / mark.len;
      mark.dz = dz / mark.len;
      mark.carry = 0;
      windEmitter.carry = 0;
      target.visible = true;
      source.visible = true;
      mark.active = true;
      mark.resolving = false;
      mark.endStart = NaN;
      dropGhost();
      if (player === X || player === O) showGhost(player, to);
    },

    resolve() {
      mark.resolving = true;
      dropGhost(); // the real seed is on its way
    },

    end() {
      if (mark.active && Number.isNaN(mark.endStart)) mark.endStart = frame.time;
    },

    update() {
      if (!mark.active) return;
      const fade = markFade(mark, frame.time);
      if (fade <= 0) {
        hide();
        return;
      }
      const pulse = 0.5 + 0.5 * Math.sin(frame.time / 260);
      target.material.opacity = fade * (0.75 + 0.25 * Math.sin(frame.time / 180));
      source.material.opacity = fade;
      if (ghost) ghost.material.opacity = fade * DASH_GHOST_OPACITY * (0.75 + 0.25 * pulse);
      if (fade < 1 || mark.resolving) return; // no new petals
      const count = emit(mark, DASH_SWIRL_RATE * frame.scale, frame.dtS);
      for (let i = 0; i < count; i++) {
        random.fill(u);
        sp.x = mark.x;
        sp.y = 0.05 + u[0] * 0.3;
        sp.z = mark.z;
        sp.radius = 0.3 + u[1] * 0.15;
        sp.angle = u[2] * TWO_PI;
        sp.spin = 6.5;
        sp.rise = 0.35;
        sp.widen = 0.05;
        sp.life = 0.7 + u[3] * 0.3;
        sp.size = (2 + u[4]) * PX;
        sp.grow = 0;
        sp.color = PETALS[i & 3];
        sp.alpha = 0.85;
        sp.shape = SHAPE_SQUARE;
        pool.spawnSpiral(sp);
      }
      // The wind: dandelion fluff and pale streaks drifting from the plant
      // to its target plot along the ground, so the path reads at a glance.
      const wind = emit(windEmitter, DASH_WIND_RATE * frame.scale, frame.dtS);
      for (let i = 0; i < wind; i++) {
        random.fill(u);
        const side = (u[0] - 0.5) * 0.18;
        sp.x = mark.x - mark.dz * side;
        sp.y = 0.06 + u[1] * 0.18;
        sp.z = mark.z + mark.dx * side;
        const speed = DASH_WIND_SPEED * (0.85 + u[2] * 0.3);
        sp.vx = mark.dx * speed;
        sp.vy = 0.02 + u[3] * 0.06;
        sp.vz = mark.dz * speed;
        sp.gravity = 0;
        sp.drag = 0;
        sp.life = mark.len / speed;
        sp.size = (2 + u[4] * 1.4) * PX;
        sp.grow = 0;
        const fluff = u[5] < 0.6;
        sp.color = fluff ? COLORS.dandelion : COLORS.windStreak;
        sp.alpha = fluff ? 0.95 : 0.6;
        sp.shape = fluff ? SHAPE_PLUS : SHAPE_SQUARE;
        pool.spawnFall(sp);
      }
    },

    reset: hide,
  };
}

// The caster's reminder of the secret Tornado Zone: the cross decal
// (decal-zone-cross, one piece per cross cell, so it is clipped at the board
// edges) with faint blue petals drifting over its cells, drawn from the
// viewer's state while the zone is theirs to see (syncTornado) and from the
// announcement event. The other seat never gets one: tornadoCrossPlan is null
// for a hidden zone. bendAt says how far the plants inside lean towards it.
function createTornadoSwirl({ world, pool, sp, random, u, frame }) {
  const material = decalMaterial(artSource(ART.v3.decal.zoneCross));
  const decals = [];
  for (let i = 0; i < ZONE_CELLS; i++) {
    const mesh = createCellDecal(material);
    mesh.renderOrder = 1;
    mesh.name = 'tornado-cross';
    world.scene.add(mesh);
    decals.push(mesh);
  }
  // The zone's centre cell (cx, cy) and its world point (x, z); fade is
  // this frame's markFade, so the bend eases off as the zone ends.
  // `cells` are the pieces of the cross plan (never copied) and `plan` is it.
  const mark = { active: false, endStart: NaN, owner: null, cx: 0, cy: 0, cells: null, plan: null, x: 0.5, z: 0.5, fade: 0.5, carry: 0.5 };
  const centreAt = { x: 0, z: 0 }; // the zone centre's world point, rewritten by show()
  const petalAt = { x: 0, z: 0 }; // the plot a petal drifts over

  const hide = () => {
    mark.active = false;
    mark.endStart = NaN;
    mark.cells = null;
    mark.plan = null;
    for (let i = 0; i < decals.length; i++) decals[i].visible = false;
  };

  return {
    centre: mark,

    show(zone) {
      const plan = tornadoCrossPlan(zone);
      if (plan === null) return;
      const { pieces } = plan;
      for (let i = 0; i < decals.length; i++) {
        const cell = pieces[i];
        decals[i].visible = Boolean(cell);
        if (!cell) continue;
        decals[i].geometry = zonePieceGeometry(cell.dx, cell.dy);
        placeOnCell(decals[i], cell.x, cell.y);
      }
      cellToWorldInto(plan.x, plan.y, centreAt);
      mark.owner = zone.player ?? null; // whose trap it is: only they (and spectators) may watch it fade
      mark.cx = plan.x;
      mark.cy = plan.y;
      mark.cells = pieces;
      mark.plan = plan;
      mark.x = centreAt.x;
      mark.z = centreAt.z;
      mark.fade = 1;
      mark.carry = 0;
      mark.active = true;
      mark.endStart = NaN;
    },

    end() {
      if (mark.active && Number.isNaN(mark.endStart)) mark.endStart = frame.time;
    },

    bendAt(x, y) {
      if (!mark.active) return 0;
      const { cells } = mark;
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].x === x && cells[i].y === y) return TORNADO_BEND_PX * mark.fade;
      }
      return 0;
    },

    update() {
      if (!mark.active) return;
      const fade = markFade(mark, frame.time);
      if (fade <= 0) {
        hide();
        return;
      }
      mark.fade = fade;
      const { plan } = mark;
      material.opacity = fade * plan.opacity * (0.8 + 0.2 * Math.sin(frame.time / 260));
      if (fade < 1) return; // ending: no new petals
      const count = emit(mark, plan.petalRate * frame.scale, frame.dtS);
      for (let i = 0; i < count; i++) {
        random.fill(u);
        // A faint blue petal drifting slowly round a cell of the cross.
        const cell = mark.cells[Math.floor(u[0] * mark.cells.length)];
        cellToWorldInto(cell.x, cell.y, petalAt);
        sp.x = petalAt.x;
        sp.y = 0.05 + u[1] * 0.2;
        sp.z = petalAt.z;
        sp.radius = 0.2 + u[2] * 0.25;
        sp.angle = u[3] * TWO_PI;
        sp.spin = 0.8 + u[4] * 0.8;
        sp.rise = 0.12 + u[5] * 0.12;
        sp.widen = 0.05;
        sp.life = 1.6 + u[6] * 0.8;
        sp.size = (2 + u[7]) * PX;
        sp.grow = 0;
        sp.color = CROSS_PETAL_COLOURS[Math.floor(u[8] * CROSS_PETAL_COLOURS.length)];
        sp.alpha = plan.petalOpacity;
        sp.shape = SHAPE_SQUARE;
        pool.spawnSpiral(sp);
      }
    },

    // The zone is gone for this viewer (its turn passed, or the state says
    // the zone is hidden): the decals, the lean and the petals still
    // circling its cells vanish at once.
    clear() {
      const { cells } = mark;
      if (cells !== null) {
        for (let i = 0; i < cells.length; i++) {
          cellToWorldInto(cells[i].x, cells[i].y, petalAt);
          pool.removeSpiralAt(petalAt.x, petalAt.z);
        }
      }
      hide();
    },

    reset: hide,
  };
}

// The revealed Tornado Zone (event tornadoStorm): the cross decal shows to
// everybody for STORM_MS and fades over MARK_FADE_MS while the whirlwind of
// the storm plan (skill-plans.js stormPlan) spins over it. It is public once
// the trap has fired, so unlike the caster's reminder it comes from the event.
function createStormCross({ world, frame }) {
  const material = decalMaterial(artSource(ART.v3.decal.zoneCross));
  const decals = [];
  for (let i = 0; i < ZONE_CELLS; i++) {
    const mesh = createCellDecal(material);
    mesh.renderOrder = 1;
    mesh.name = 'storm-cross';
    world.scene.add(mesh);
    decals.push(mesh);
  }
  const mark = { active: false, start: 0.5 };
  const cellIndex = new Int16Array(decals.length).fill(-1); // the plot index each decal piece lies on, -1 for none

  const hide = () => {
    mark.active = false;
    cellIndex.fill(-1);
    for (let i = 0; i < decals.length; i++) decals[i].visible = false;
  };

  return {
    cellIndex,

    get active() {
      return mark.active;
    },

    // `covered` marks the plots the viewer's state covers (cell index to 1):
    // the pieces on those plots are never shown.
    show({ x, y, cells }, covered) {
      for (let i = 0; i < decals.length; i++) {
        const cell = cells[i];
        const plot = cell ? cell.y * BOARD_SIZE + cell.x : -1;
        cellIndex[i] = plot;
        decals[i].visible = Boolean(cell) && covered[plot] === 0;
        if (!cell) continue;
        decals[i].geometry = zonePieceGeometry(cell.x - x, cell.y - y);
        placeOnCell(decals[i], cell.x, cell.y);
      }
      mark.start = frame.time;
      mark.active = true;
    },

    // The plot with this index has just become covered for the viewer.
    hidePlot(plot) {
      for (let i = 0; i < decals.length; i++) {
        if (cellIndex[i] === plot) decals[i].visible = false;
      }
    },

    update() {
      if (!mark.active) return;
      const age = frame.time - mark.start;
      if (age >= STORM_MS + MARK_FADE_MS) {
        hide();
        return;
      }
      const fadeOut = age > STORM_MS ? 1 - (age - STORM_MS) / MARK_FADE_MS : 1;
      material.opacity = Math.min(1, Math.max(0, age) / STORM_FADE_IN_MS) * fadeOut;
    },

    reset: hide,
  };
}

// One Points draw call for every particle: crisp square pixels (or plus
// shaped twinkles) whose screen size is a whole number of pixels.
function createParticlePoints(capacity) {
  const geometry = new THREE.BufferGeometry();
  const attribute = (size) => new THREE.BufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
  const position = attribute(3);
  const color = attribute(3);
  const alpha = attribute(1);
  const size = attribute(1);
  const shape = attribute(1);
  geometry.setAttribute('position', position);
  geometry.setAttribute('aColor', color);
  geometry.setAttribute('aAlpha', alpha);
  geometry.setAttribute('aSize', size);
  geometry.setAttribute('aShape', shape);
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 }, uSparkleGlow: GLOW.uSparkleGlow },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aAlpha;
      attribute float aSize;
      attribute float aShape;
      uniform float uScale;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vShape;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // World size to whole screen pixels, so particles stay crisp.
        gl_PointSize = max(1.0, floor(aSize * uScale / -mvPosition.z + 0.5));
        vColor = aColor;
        vAlpha = aAlpha;
        vShape = aShape;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uSparkleGlow;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vShape;
      void main() {
        vec2 p = abs(gl_PointCoord - 0.5);
        if (vShape > 0.5 && min(p.x, p.y) > 0.17) discard; // plus-shaped twinkle
        vec3 color = pow(vColor, vec3(2.2)); // sRGB colours to linear
        if (vShape > 0.5) color *= uSparkleGlow; // sparkles glow while bloom is on (GLOW)
        gl_FragColor = vec4(color, vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const { uScale } = material.uniforms;
  const mesh = new THREE.Points(geometry, material);
  mesh.frustumCulled = false; // the particles move every frame
  mesh.renderOrder = 10;

  return {
    mesh,
    // Copies the live particles of `pool` into the buffers.
    sync(pool, frame) {
      const n = pool.count;
      const p = position.array;
      const c = color.array;
      for (let i = 0; i < n; i++) {
        p[i * 3] = pool.x[i];
        p[i * 3 + 1] = pool.y[i];
        p[i * 3 + 2] = pool.z[i];
        c[i * 3] = pool.r[i];
        c[i * 3 + 1] = pool.g[i];
        c[i * 3 + 2] = pool.b[i];
        alpha.array[i] = pool.alphaAt(i);
        size.array[i] = pool.sizeAt(i);
        shape.array[i] = pool.shape[i];
      }
      geometry.setDrawRange(0, n);
      // Only on a resize: a number written into a Three.js object every
      // frame would be boxed by the JS engine each time.
      if (uScale.value !== frame.pointScale) uScale.value = frame.pointScale;
      if (n > 0) {
        position.needsUpdate = true;
        color.needsUpdate = true;
        alpha.needsUpdate = true;
        size.needsUpdate = true;
        shape.needsUpdate = true;
      }
    },
  };
}
