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
//   Tornado Zone      a translucent swirl of petals and leaves over the
//                     zone (decal-zone-v3) that the plants inside bend
//                     towards (High); a thrown plant flies off as a seed in
//                     an arc, lands with a soil puff and regrows from Land
//   Terrain Creation  the rock falls from above with a growing shadow, lands
//                     with a soil puff and a light camera shake (High only,
//                     the only shake); when it breaks it crumbles into soil
//                     crumbs and pebbles, leaving bare soil
//   placement         the placement effect of the character whose side
//                     planted the seed (placement(), character-look.js):
//                     Wind Rabbit's dandelion wind, Earth Bear's soil
//                     burst, Jade Serpent's vine coil
//   Stone Conversion  the plant wilts back to Sprout, a small spark runs
//                     through the soil and the other team's plant regrows
//                     from Land (X becomes O or O becomes X)
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
  BANNER_3D_Y, BOARD_SIZE, CAMERA_FOV, CONVERT_SPARK_RATE, DASH_SWIRL_RATE, DASH_TRAIL_RATE,
  MARK_FADE_MS, PLACE_DUST_COUNT, PLACEMENT_SLOTS, PLANT_OPEN_SPARKLES, PX_WORLD, SOIL_PUFF_MAX, SOIL_PUFF_MIN, SOIL_PUFF_MS,
  SPRITE_STRETCH_Y, THROW_ARC_HEIGHT, TORNADO_BEND_PX, TORNADO_PARTICLE_RATE, TORNADO_SIZE, VINE_POINT_PX, VINE_POINTS,
} from '../config.js';
import { X } from '../logic/board.js';
import { createBanners } from '../render/effects.js';
import { artMeta, artSource } from './art.js';
import { ART } from './art-assets.js';
import { PLAN_SEED, placementPlan } from './character-look.js';
import {
  catchUpVisuals, convertPose, crumblePose, dashCurveInto, dashPose, heldCell, regrowCell, rockFallPose,
  shakeLeft, shakeOffset3d, shakeStrength, sparkPathInto, throwPose, visualsForEvents,
} from './effect-plans.js';
import { STAGE_DROP, STAGE_REST } from './growth.js';
import {
  createParticlePool, createSpawnParams, emit, scaledCount, SHAPE_PLUS, SHAPE_SQUARE,
} from './particle-pool.js';
import { cellToWorld, cellToWorldInto } from './picking.js';
import { clearPlacementRuns, createPlacementRuns, startPlacementRun, stepPlacementRuns, vinePointsInto } from './placement-runs.js';
import { GLOW } from './post-processing.js';
import { MAX_PARTICLE_CAP, particleScale, plainSlides } from './quality.js';
import { effectRandom } from './seeded-random.js';
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
const ZONE_HALF = (TORNADO_SIZE - 1) / 2; // zone cells reach this far from its centre

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
    u: new Float64Array(10),
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
  const vinePool = createParticlePool(VINE_POINTS * PLACEMENT_SLOTS);
  const vinePoints = createParticlePoints(vinePool.capacity);
  world.scene.add(vinePoints.mesh);
  const vineXyz = new Float32Array(VINE_POINTS * 3);
  const held = new Float64Array(BOARD_SIZE * BOARD_SIZE); // cell index -> time its plant shows again
  const timelines = [];
  for (let i = 0; i < TIMELINE_SLOTS; i++) timelines.push(newTimeline());
  const dashMark = createDashMark(fx);
  const swirl = createTornadoSwirl(fx);
  // The camera shake: when it started and how strong it is; shakeOffset3d
  // reads ageMs and strength and writes the offset x and y.
  const shake = { start: -Infinity, ageMs: 0.5, strength: 0.5, x: 0.5, y: 0.5 };
  // The pose functions read ageMs (and progress, spark) and write the pose here.
  const pose = { ageMs: 0.5, frame: 0, done: false, flying: false, progress: 0.5, spark: 0.5, x: 0.5, z: 0.5, lift: 0.5 };
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

  // Soil crumbs with the odd pebble (every third) bursting from a rock.
  function crumbs(wx, wz, base) {
    const count = scaledCount(base, frame.scale);
    for (let i = 0; i < count; i++) {
      random.fill(u);
      const angle = u[0] * TWO_PI;
      const speed = 0.6 + u[1];
      const pebble = i % 3 === 0;
      sp.x = wx;
      sp.y = 0.1 + u[2] * 0.3;
      sp.z = wz;
      sp.vx = Math.cos(angle) * speed;
      sp.vy = 1.5 + u[3] * 1.5;
      sp.vz = Math.sin(angle) * speed;
      sp.gravity = 12;
      sp.drag = 0.5;
      sp.life = 0.5 + u[4] * 0.3;
      sp.size = (pebble ? 3 + u[5] : 2 + u[5]) * PX;
      sp.grow = 0;
      sp.color = pebble ? (u[6] < 0.5 ? COLORS.pebble : COLORS.pebbleDark) : SOILS[i % 3];
      sp.alpha = 1;
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

  // --- Placement effects ---

  // One particle step of a placement plan (character-look.js) on the plot
  // of `run`: it flies from `from` to `to` over its duration, along an arc
  // `height` (or `curve`) high when it has one. Called once per step by
  // stepPlacementRuns; the vine steps are drawn by drawVines instead.
  function spawnPlanStep(step, run) {
    if (!step.particle) return;
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
      default:
        return;
    }
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
    });
    return record;
  }

  function endTimeline(record) {
    if (record.a) actors.release(record.a);
    record.a = null;
    record.active = false;
  }

  // One frame of a running skill animation.
  function stepTimeline(record) {
    pose.ageMs = frame.time - record.start;
    const { a } = record;
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
        throwPose(pose, frame.plain);
        a.sprite.setFrame(STAGE_DROP);
        moveAlong(record, a, pose.progress);
        a.sprite.plane.position.y = pose.dropPx * PX * SPRITE_STRETCH_Y + pose.height;
        a.setShadow(1 - (0.5 * pose.height) / THROW_ARC_HEIGHT);
        if (pose.progress > 0) {
          at.y = 0.15 + pose.height;
          petalTrail(emit(record, DASH_TRAIL_RATE * 0.4 * frame.scale, frame.dtS), 0.7);
        }
        if (pose.done) {
          soilPuff(record.tx, record.tz, PLACE_DUST_COUNT, 1.3);
          endTimeline(record);
        }
        break;
      case 'rockFall':
        rockFallPose(pose);
        a.sprite.plane.position.y = pose.height;
        a.sprite.plane.scale.set(pose.scaleX, pose.scaleY, 1);
        a.setShadow(pose.shadow);
        if (pose.landed && !record.landed) {
          record.landed = true;
          soilPuff(record.tx, record.tz, PLACE_DUST_COUNT * 2, 2.2);
          crumbs(record.tx, record.tz, 6);
          startShake(shakeStrength(record));
        }
        if (pose.done) endTimeline(record);
        break;
      case 'rockCrumble':
        crumblePose(pose);
        a.sprite.plane.scale.set(pose.scaleX, pose.scaleY, 1);
        if (pose.done) endTimeline(record);
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
        dashMark.show(spec.from, spec.to);
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
      case 'tornadoEnd':
        swirl.end();
        break;
      case 'dashClear':
        dashMark.reset();
        break;
      case 'tornadoClear':
        swirl.reset();
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
      case 'rockFall': {
        const record = startTimeline('rockFall', spec, spec, stages);
        record.a = actors.acquire('rock', spec);
        break;
      }
      case 'rockCrumble': {
        const record = startTimeline('rockCrumble', spec, spec, stages);
        record.a = actors.acquire('rock', spec);
        crumbs(record.tx, record.tz, 14);
        soilPuff(record.tx, record.tz, PLACE_DUST_COUNT, 1.4);
        break;
      }
      case 'convert': {
        const record = startTimeline('convert', spec, spec, stages);
        record.a = actors.acquire(spec.from, spec);
        break;
      }
      case 'banner':
        banners.add(spec.text, frame.time);
        break;
    }
  }

  return {
    // Starts the visuals for the events of one applied action at `time`.
    trigger(events, time) {
      frame.time = time;
      frame.scale = particleScale(world.features);
      pool.limit = Math.min(pool.capacity, world.features.particleCap);
      for (const spec of visualsForEvents(events)) start(spec);
    },

    // Events that piled up while the page was hidden: only the Wind Dash
    // marks and the Tornado Zone are brought up to date (catchUpVisuals).
    catchUp(events, time) {
      frame.time = time;
      for (const spec of catchUpVisuals(events)) start(spec);
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
    // (mark-tints.js).
    setPlantSheets(sheets) {
      actors.setPlantSheets(sheets);
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
      for (let i = 0; i < timelines.length; i++) {
        if (timelines[i].active) stepTimeline(timelines[i]);
      }
      stepPlacementRuns(placements, time, spawnPlanStep);
      drawVines();

      pool.step(frame);
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
      vinePool.clear();
      vinePoints.sync(vinePool, frame);
      dashMark.reset();
      swirl.reset();
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
// its plant; landed marks a one-off moment (a rock's impact, a dashing
// seed's take-off).
function newTimeline() {
  return { active: false, kind: null, start: 0.5, fx: 0.5, fz: 0.5, tx: 0.5, tz: 0.5, stages: null, a: null, landed: false, carry: 0.5 };
}

// Pooled plant and rock sprites ('X', 'O' or 'rock') that the skill
// animations fold, fly, drop, squash and light up. Each has its own material with an
// emissive map set up once, so the glow never rebuilds a shader.
function createActorPool(world) {
  const free = { X: [], O: [], rock: [] };
  let plantSheets = { X: null, O: null }; // the tinted plant sheets (setPlantSheets), null: the art's own

  function make(kind) {
    const sheet = kind === 'rock' ? null : plantSheets[kind];
    const sprite = world.addSprite(createPieceSprite(kind, sheet));
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
      if (actor.kind !== 'rock') sprite.setFrame(STAGE_REST);
      if (actor.kind !== 'rock' && actor.sheet !== plantSheets[actor.kind]) dropStaleActor(world, actor);
      else free[actor.kind].push(actor);
    },

    // New plant sheets: the waiting plant actors are freed; one still
    // flying is freed when it lands (release).
    setPlantSheets(sheets) {
      plantSheets = sheets;
      for (const kind of ['X', 'O']) {
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
function createDashMark({ world, pool, sp, random, u, frame }) {
  const make = (art, order) => {
    const mesh = createCellDecal(decalMaterial(artSource(art)));
    mesh.renderOrder = order;
    world.scene.add(mesh);
    return mesh;
  };
  const target = make(ART.v3.decal.dashTarget, 4);
  const source = make(ART.v3.decal.select, 5);
  // endStart is NaN while the mark shows; resolving stops the petals while
  // the seed flies; carry is the emission remainder.
  const mark = { active: false, resolving: false, endStart: NaN, x: 0.5, z: 0.5, carry: 0.5 };

  const hide = () => {
    mark.active = false;
    mark.endStart = NaN;
    target.visible = false;
    source.visible = false;
  };

  return {
    show(from, to) {
      placeOnCell(target, to.x, to.y);
      placeOnCell(source, from.x, from.y);
      mark.x = source.position.x;
      mark.z = source.position.z;
      mark.carry = 0;
      target.visible = true;
      source.visible = true;
      mark.active = true;
      mark.resolving = false;
      mark.endStart = NaN;
    },

    resolve() {
      mark.resolving = true;
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
      target.material.opacity = fade * (0.75 + 0.25 * Math.sin(frame.time / 180));
      source.material.opacity = fade;
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
    },

    reset: hide,
  };
}

// The announced Tornado Zone: decal-zone-v3 centred on the zone, one piece
// per zone cell so it is clipped at the board edges, and a translucent
// swirl of petals and leaves rising over the zone, from 'tornadoAnnounced'
// until it ends. bendAt says how far the plants inside lean towards it.
function createTornadoSwirl({ world, pool, sp, random, u, frame }) {
  const material = decalMaterial(artSource(ART.v3.decal.zone));
  const decals = [];
  for (let i = 0; i < TORNADO_SIZE * TORNADO_SIZE; i++) {
    const mesh = createCellDecal(material);
    mesh.renderOrder = 1;
    world.scene.add(mesh);
    decals.push(mesh);
  }
  // The zone's centre cell (cx, cy) and its world point (x, z); fade is
  // this frame's markFade, so the bend eases off as the zone ends.
  const mark = { active: false, endStart: NaN, cx: 0, cy: 0, x: 0.5, z: 0.5, fade: 0.5, carry: 0.5 };
  const centreAt = { x: 0, z: 0 }; // the zone centre's world point, rewritten by show()

  const hide = () => {
    mark.active = false;
    mark.endStart = NaN;
    for (let i = 0; i < decals.length; i++) decals[i].visible = false;
  };

  return {
    centre: mark,

    show({ x, y, cells }) {
      for (let i = 0; i < decals.length; i++) {
        const cell = cells[i];
        decals[i].visible = Boolean(cell);
        if (!cell) continue;
        decals[i].geometry = zonePieceGeometry(cell.x - x, cell.y - y);
        placeOnCell(decals[i], cell.x, cell.y);
      }
      cellToWorldInto(x, y, centreAt);
      mark.cx = x;
      mark.cy = y;
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
      if (!mark.active || Math.abs(x - mark.cx) > ZONE_HALF || Math.abs(y - mark.cy) > ZONE_HALF) return 0;
      return TORNADO_BEND_PX * mark.fade;
    },

    update() {
      if (!mark.active) return;
      const fade = markFade(mark, frame.time);
      if (fade <= 0) {
        hide();
        return;
      }
      mark.fade = fade;
      material.opacity = fade * (0.8 + 0.2 * Math.sin(frame.time / 260));
      if (fade < 1) return; // ending: no new petals
      const count = emit(mark, TORNADO_PARTICLE_RATE * frame.scale, frame.dtS);
      for (let i = 0; i < count; i++) {
        random.fill(u);
        // Petals of every colour, with leaves caught up among them.
        const leaf = u[0] < 0.3;
        sp.x = mark.x;
        sp.y = 0.02 + u[1] * 0.23;
        sp.z = mark.z;
        sp.radius = 0.25 + u[2] * 0.85;
        sp.angle = u[3] * TWO_PI;
        sp.spin = 4.5 + u[4] * 2.5;
        sp.rise = 1 + u[5] * 0.8;
        sp.widen = 0.3 + u[6] * 0.25;
        sp.life = 1.3 + u[7] * 0.7;
        sp.size = (2 + u[8]) * PX;
        sp.grow = 0;
        sp.color = leaf ? (u[9] < 0.5 ? COLORS.leaf : COLORS.leafDark) : PETALS[Math.floor(u[9] * 4)];
        sp.alpha = 0.6; // translucent: the plants show through the swirl
        sp.shape = SHAPE_SQUARE;
        pool.spawnSpiral(sp);
      }
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
