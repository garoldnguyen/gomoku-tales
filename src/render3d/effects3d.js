// Skill visuals and placement effects in the 3D world
// (docs/art-direction-hd2d.md section G). Everything is started by the
// events returned by src/logic (see effect-plans.js visualsForEvents) and
// never changes the rules:
//   placed stone      sparkles, a dust puff and a light camera shake (the
//                     pop-in bounce is the piece layer's, world-renderer.js)
//   Wind Dash         a pale blue swirl around the source stone and a red
//                     translucent frame decal on the target until the dash
//                     ends; when it resolves the stone streaks across with
//                     a trail
//   Tornado Zone      a translucent swirling column of particles over the
//                     zone; a thrown stone flies in an arc and lands with a
//                     dust puff
//   Terrain Creation  the rock falls from above with a growing shadow,
//                     impact dust and a camera shake; it crumbles with dust
//                     when it breaks
//   Stone Conversion  the stone glows, lifts, flips and lands as the other
//                     colour
//   skill banners     HUD text on the 2D canvas over the world
// The always-on drifting wind streaks belong to the scenery
// (breeze-hill.js).
//
// Kept cheap: all particles share one fixed-size pool (particle-pool.js)
// drawn as one Points draw call, flying pieces are pooled sprites and the
// decals are made once. The per-frame update allocates nothing: particles
// spawn through one reused parameter object, they take their random
// numbers from a typed array filled by an integer generator
// (seeded-random.js effectRandom), and
// per-frame numbers are shared through the `frame` object rather than
// passed between functions, so the JS engine never boxes them. The quality
// level scales particle counts and rates (quality.js `particles`).
//
// While a flying copy of a piece is on its way to a cell, holds(cellIndex,
// time) is true and the piece layer hides the real piece there.

import * as THREE from 'three';
import {
  BANNER_3D_Y, BOARD_SIZE, CAMERA_FOV, CONVERT_SPARKLE_RATE, DASH_SWIRL_RATE, DASH_TRAIL_RATE,
  EFFECT_PARTICLE_CAPACITY, MARK_FADE_MS, PLACE_DUST_COUNT, PLACE_SPARKLE_COUNT, PX_WORLD, THROW_ARC_HEIGHT,
  TORNADO_PARTICLE_RATE, TORNADO_SIZE,
} from '../config.js';
import { X } from '../logic/board.js';
import { createBanners } from '../render/effects.js';
import { artSource } from './art.js';
import { ART } from './art-assets.js';
import {
  catchUpVisuals, convertPose, crumblePose, dashPose, heldCell, rockFallPose, shakeLeft, shakeOffset3d, shakeStrength,
  throwPose, visualsForEvents,
} from './effect-plans.js';
import {
  createParticlePool, createSpawnParams, emit, scaledCount, SHAPE_PLUS, SHAPE_SQUARE,
} from './particle-pool.js';
import { cellToWorld } from './picking.js';
import { QUALITY_LEVELS } from './quality.js';
import { effectRandom } from './seeded-random.js';
import { createCellDecal, createPieceSprite, decalMaterial, placeOnCell } from './world.js';

const COLORS = {
  sparkle: 0xfffbe0,
  sparkleX: 0xbfe0ff,
  sparkleO: 0xffc8cf,
  dust: 0xc8a878,
  dustDark: 0x8a6a44,
  wind: 0xffffff,
  windBlue: 0xbfe8ff,
  swirl: 0x9fd8ff,
  rock: 0x9a9aa6,
  rockDark: 0x5e5e6c,
  petal: 0xffc0dc,
  leaf: 0x8fdc6a,
  glow: 0xfff6c0,
};

const PX = PX_WORLD; // particle sizes are in art pixels, like the sprites
const CONVERT_GLOW = 0.9; // emissive intensity of a converting stone at full glow
const TIMELINE_SLOTS = 16; // skill animations running at once before more records are made
const MAX_STEP_MS = 100; // a hidden tab does not make the effects jump on return
const TWO_PI = Math.PI * 2;

// Builds the effects on `world` (world.js). Call trigger() with the events
// of each applied action (catchUp() for events that piled up while the
// page was hidden), update(time) every frame before world.render(),
// drawBanner(ctx, time) after the HUD, and reset() for a new game.
export function createEffects3d(world) {
  const fx = {
    world,
    pool: createParticlePool(EFFECT_PARTICLE_CAPACITY),
    sp: createSpawnParams(),
    // Every emitter calls random.fill(u) per particle and reads u[0],
    // u[1], ... in [0, 1). For looks only; it never touches the game.
    random: effectRandom(0x2545f491),
    u: new Float64Array(10),
    // This frame's numbers: time (ms), dtS (seconds since the last frame),
    // scale (particle scale of the quality level), pointScale (particle
    // world size to screen pixels at depth 1). last is NaN until the first
    // frame.
    frame: { last: NaN, time: 0.5, dtS: 0.5, scale: 1, pointScale: 1.5 },
  };
  const { pool, sp, random, u, frame } = fx;

  const points = createParticlePoints(EFFECT_PARTICLE_CAPACITY);
  world.scene.add(points.mesh);
  const banners = createBanners();
  const actors = createActorPool(world);
  const held = new Float64Array(BOARD_SIZE * BOARD_SIZE); // cell index -> time its piece shows again
  const timelines = [];
  for (let i = 0; i < TIMELINE_SLOTS; i++) timelines.push(newTimeline());
  const dashMark = createDashMark(fx);
  const column = createTornadoColumn(fx);
  // The camera shake: when it started and how strong it is; shakeOffset3d
  // reads ageMs and strength and writes the offset x and y.
  const shake = { start: -Infinity, ageMs: 0.5, strength: 0.5, x: 0.5, y: 0.5 };
  const pose = { ageMs: 0.5, x: 1, y: 1 }; // the pose functions read ageMs and write the pose here
  const at = { x: 0.5, y: 0.5, z: 0.5 }; // where a trail is left this frame
  const pointScaleFactor = 1 / (2 * Math.tan((CAMERA_FOV * Math.PI) / 360));

  const particleScale = () => QUALITY_LEVELS[world.quality]?.particles ?? 1;

  // --- Particle bursts ---

  function sparkles(wx, wz, player, base) {
    const count = scaledCount(base, frame.scale);
    const tint = player === null ? COLORS.windBlue : player === X ? COLORS.sparkleX : COLORS.sparkleO;
    for (let i = 0; i < count; i++) {
      random.fill(u);
      const angle = (i / count) * TWO_PI + u[0] * 0.5;
      const speed = 0.7 + u[1] * 0.8;
      sp.x = wx;
      sp.y = 0.15 + u[2] * 0.25;
      sp.z = wz;
      sp.vx = Math.cos(angle) * speed;
      sp.vy = 1.2 + u[3];
      sp.vz = Math.sin(angle) * speed;
      sp.gravity = 4;
      sp.drag = 1.5;
      sp.life = 0.4 + u[4] * 0.2;
      sp.size = 3 * PX;
      sp.grow = 0;
      sp.color = i % 2 ? tint : COLORS.sparkle;
      sp.alpha = 1;
      sp.shape = SHAPE_PLUS;
      pool.spawnFall(sp);
    }
  }

  function dustPuff(wx, wz, base, speedScale) {
    const count = scaledCount(base, frame.scale);
    for (let i = 0; i < count; i++) {
      random.fill(u);
      const angle = (i / count) * TWO_PI + u[0] * 0.6;
      const speed = (0.5 + u[1] * 0.6) * speedScale;
      sp.x = wx + Math.cos(angle) * 0.2;
      sp.y = 0.06;
      sp.z = wz + Math.sin(angle) * 0.2;
      sp.vx = Math.cos(angle) * speed;
      sp.vy = 0.3 + u[2] * 0.4;
      sp.vz = Math.sin(angle) * speed;
      sp.gravity = 0.8;
      sp.drag = 3;
      sp.life = 0.4 + u[3] * 0.15;
      sp.size = (3 + u[4]) * PX;
      sp.grow = 3 * PX;
      sp.color = i % 2 ? COLORS.dust : COLORS.dustDark;
      sp.alpha = 0.85;
      sp.shape = SHAPE_SQUARE;
      pool.spawnFall(sp);
    }
  }

  function rubble(wx, wz, base) {
    const count = scaledCount(base, frame.scale);
    for (let i = 0; i < count; i++) {
      random.fill(u);
      const angle = u[0] * TWO_PI;
      const speed = 0.6 + u[1];
      sp.x = wx;
      sp.y = 0.1 + u[2] * 0.3;
      sp.z = wz;
      sp.vx = Math.cos(angle) * speed;
      sp.vy = 1.5 + u[3] * 1.5;
      sp.vz = Math.sin(angle) * speed;
      sp.gravity = 12;
      sp.drag = 0.5;
      sp.life = 0.5 + u[4] * 0.3;
      sp.size = (2 + u[5] * 2) * PX;
      sp.grow = 0;
      sp.color = i % 3 ? COLORS.rock : COLORS.rockDark;
      sp.alpha = 1;
      sp.shape = SHAPE_SQUARE;
      pool.spawnFall(sp);
    }
  }

  // Wind puffs circling a cell (a thrown stone with nowhere to go, a dash
  // that failed).
  function gust(wx, wz, base) {
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
      sp.color = i % 2 ? COLORS.wind : COLORS.windBlue;
      sp.alpha = 0.8;
      sp.shape = SHAPE_SQUARE;
      pool.spawnSpiral(sp);
    }
  }

  // Short-lived wind specks left behind a flying stone at `at`.
  function trail(count, alpha) {
    for (let i = 0; i < count; i++) {
      random.fill(u);
      sp.x = at.x - 0.12 + u[0] * 0.24;
      sp.y = at.y - 0.08 + u[1] * 0.2;
      sp.z = at.z - 0.12 + u[2] * 0.24;
      sp.vx = -0.2 + u[3] * 0.4;
      sp.vy = u[4] * 0.25;
      sp.vz = -0.2 + u[5] * 0.4;
      sp.gravity = 0;
      sp.drag = 2;
      sp.life = 0.3 + u[6] * 0.15;
      sp.size = (2 + u[7]) * PX;
      sp.grow = -PX;
      sp.color = i % 2 ? COLORS.wind : COLORS.windBlue;
      sp.alpha = alpha;
      sp.shape = SHAPE_SQUARE;
      pool.spawnFall(sp);
    }
  }

  // Warm twinkles rising around a glowing stone.
  function glowSparkles(record, count) {
    for (let i = 0; i < count; i++) {
      random.fill(u);
      sp.x = record.tx;
      sp.y = 0.05 + u[0] * 0.25;
      sp.z = record.tz;
      sp.radius = 0.25 + u[1] * 0.15;
      sp.angle = u[2] * TWO_PI;
      sp.spin = 3;
      sp.rise = 1.1;
      sp.widen = 0;
      sp.life = 0.5 + u[3] * 0.2;
      sp.size = 3 * PX;
      sp.grow = 0;
      sp.color = COLORS.glow;
      sp.alpha = 1;
      sp.shape = SHAPE_PLUS;
      pool.spawnSpiral(sp);
    }
  }

  // A new shake replaces the current one only if it is stronger than what
  // is left of it.
  function startShake(strength) {
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

  // --- Skill animations with flying pieces ---

  function startTimeline(kind, from, to) {
    let record = timelines.find((t) => !t.active);
    if (!record) {
      record = newTimeline();
      timelines.push(record);
    }
    const a = cellToWorld(from.x, from.y);
    const b = cellToWorld(to.x, to.y);
    Object.assign(record, { active: true, kind, start: frame.time, fx: a.x, fz: a.z, tx: b.x, tz: b.z, landed: false, carry: 0 });
    return record;
  }

  function endTimeline(record) {
    if (record.a) actors.release(record.a);
    if (record.b) actors.release(record.b);
    record.a = null;
    record.b = null;
    record.active = false;
  }

  // One frame of a running skill animation.
  function stepTimeline(record) {
    pose.ageMs = frame.time - record.start;
    const { a } = record;
    switch (record.kind) {
      case 'dashStreak':
        dashPose(pose);
        moveAlong(record, a, pose.progress);
        a.sprite.plane.position.y = pose.lift;
        at.y = 0.25 + pose.lift;
        trail(emit(record, DASH_TRAIL_RATE * frame.scale, frame.dtS), 0.85);
        if (pose.done) {
          sparkles(record.tx, record.tz, record.player, PLACE_SPARKLE_COUNT);
          dustPuff(record.tx, record.tz, PLACE_DUST_COUNT, 1);
          startShake(shakeStrength(record));
          endTimeline(record);
        }
        break;
      case 'throw':
        throwPose(pose);
        moveAlong(record, a, pose.progress);
        a.sprite.plane.position.y = pose.height;
        a.sprite.plane.scale.set(pose.scaleX, pose.scaleY, 1);
        a.setShadow(1 - (0.5 * pose.height) / THROW_ARC_HEIGHT);
        if (pose.progress > 0) {
          at.y = 0.25 + pose.height;
          trail(emit(record, DASH_TRAIL_RATE * 0.4 * frame.scale, frame.dtS), 0.6);
        }
        if (pose.done) {
          dustPuff(record.tx, record.tz, PLACE_DUST_COUNT, 1.3);
          startShake(shakeStrength(record));
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
          dustPuff(record.tx, record.tz, PLACE_DUST_COUNT * 2, 2.2);
          rubble(record.tx, record.tz, 8);
          startShake(shakeStrength(record));
        }
        if (pose.done) endTimeline(record);
        break;
      case 'rockCrumble':
        crumblePose(pose);
        a.sprite.plane.scale.set(pose.scaleX, pose.scaleY, 1);
        if (pose.done) endTimeline(record);
        break;
      case 'convert': {
        convertPose(pose);
        const { b } = record;
        a.sprite.object.visible = !pose.showNew;
        b.sprite.object.visible = pose.showNew;
        poseConverting(a, pose);
        poseConverting(b, pose);
        if (pose.glow > 0.5 && !pose.showNew) glowSparkles(record, emit(record, CONVERT_SPARKLE_RATE * frame.scale, frame.dtS));
        if (pose.done) {
          sparkles(record.tx, record.tz, record.player, PLACE_SPARKLE_COUNT);
          dustPuff(record.tx, record.tz, PLACE_DUST_COUNT, 1);
          startShake(shakeStrength(record));
          endTimeline(record);
        }
        break;
      }
    }
  }

  function hold(spec) {
    const cell = heldCell(spec);
    if (!cell) return;
    const i = cell.y * BOARD_SIZE + cell.x;
    held[i] = Math.max(held[i], frame.time + cell.ms);
  }

  function start(spec) {
    hold(spec);
    switch (spec.kind) {
      case 'place': {
        const { x, z } = cellToWorld(spec.x, spec.y);
        sparkles(x, z, spec.player, PLACE_SPARKLE_COUNT);
        dustPuff(x, z, PLACE_DUST_COUNT, 1);
        startShake(shakeStrength(spec));
        break;
      }
      case 'dashMark':
        dashMark.show(spec.from, spec.to);
        break;
      case 'dashStreak': {
        dashMark.end();
        const record = startTimeline('dashStreak', spec.from, spec.to);
        record.player = spec.player;
        record.a = actors.acquire(spec.player, spec.from);
        dustPuff(record.fx, record.fz, PLACE_DUST_COUNT, 1);
        break;
      }
      case 'dashFizzle': {
        dashMark.end();
        const from = cellToWorld(spec.from.x, spec.from.y);
        const to = cellToWorld(spec.to.x, spec.to.y);
        gust(from.x, from.z, 10);
        dustPuff(to.x, to.z, PLACE_DUST_COUNT, 1);
        break;
      }
      case 'tornado':
        column.show(spec);
        break;
      case 'tornadoEnd':
        column.end();
        break;
      case 'dashClear':
        dashMark.reset();
        break;
      case 'tornadoClear':
        column.reset();
        break;
      case 'endLingering':
        column.end();
        dashMark.end();
        break;
      case 'throw': {
        const record = startTimeline('throw', spec.from, spec.to);
        record.player = spec.player;
        record.a = actors.acquire(spec.player, spec.from);
        break;
      }
      case 'throwBlocked': {
        const { x, z } = cellToWorld(spec.x, spec.y);
        gust(x, z, 14);
        break;
      }
      case 'rockFall': {
        const record = startTimeline('rockFall', spec, spec);
        record.a = actors.acquire('rock', spec);
        break;
      }
      case 'rockCrumble': {
        const record = startTimeline('rockCrumble', spec, spec);
        record.a = actors.acquire('rock', spec);
        rubble(record.tx, record.tz, 12);
        dustPuff(record.tx, record.tz, PLACE_DUST_COUNT, 1.4);
        break;
      }
      case 'convert': {
        const record = startTimeline('convert', spec, spec);
        record.player = spec.to;
        record.a = actors.acquire(spec.from, spec);
        record.b = actors.acquire(spec.to, spec);
        record.b.sprite.object.visible = false;
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
      frame.scale = particleScale();
      for (const spec of visualsForEvents(events)) start(spec);
    },

    // Events that piled up while the page was hidden: only the Wind Dash
    // marks and the Tornado Zone are brought up to date (catchUpVisuals).
    catchUp(events, time) {
      frame.time = time;
      for (const spec of catchUpVisuals(events)) start(spec);
    },

    // True while the piece on cell index `i` (y * BOARD_SIZE + x) is shown
    // arriving by a flying copy, so the real one stays hidden.
    holds(i, time) {
      return held[i] > time;
    },

    // Advances every effect to `time` (ms) and moves the camera for the shake.
    update(time) {
      frame.dtS = Number.isNaN(frame.last) ? 0 : Math.min(Math.max(0, time - frame.last), MAX_STEP_MS) / 1000;
      frame.last = time;
      frame.time = time;
      frame.scale = particleScale();
      frame.pointScale = world.drawingHeight * pointScaleFactor;

      dashMark.update();
      column.update();
      for (let i = 0; i < timelines.length; i++) {
        if (timelines[i].active) stepTimeline(timelines[i]);
      }

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
      dashMark.reset();
      column.reset();
      held.fill(0);
      banners.clear();
      shake.start = -Infinity;
      shake.x = 0;
      shake.y = 0;
      world.setCameraShake(shake);
    },
  };
}

// Both stones of a conversion (the old colour and the new) follow one pose.
function poseConverting(actor, pose) {
  actor.sprite.plane.position.y = pose.lift;
  actor.sprite.plane.scale.x = pose.width;
  actor.material.emissiveIntensity = CONVERT_GLOW * pose.glow;
  actor.setShadow(1 - 0.3 * pose.lift);
}

// A skill animation record, reused. carry is its particle emission
// remainder (particle-pool.js emit).
function newTimeline() {
  return { active: false, kind: null, start: 0.5, fx: 0.5, fz: 0.5, tx: 0.5, tz: 0.5, player: null, a: null, b: null, landed: false, carry: 0.5 };
}

// Pooled piece sprites ('X', 'O' or 'rock') that the skill animations move,
// lift, squash, flip and light up. Each has its own material with an
// emissive map set up once, so the glow never rebuilds a shader.
function createActorPool(world) {
  const free = { X: [], O: [], rock: [] };

  function make(kind) {
    const sprite = world.addSprite(createPieceSprite(kind));
    const material = sprite.plane.material;
    material.emissive.set(COLORS.glow);
    material.emissiveMap = sprite.texture;
    material.emissiveIntensity = 0;
    const shadowX = sprite.shadow.scale.x;
    const shadowZ = sprite.shadow.scale.z;
    return {
      kind,
      sprite,
      material,
      setShadow(factor) {
        sprite.shadow.scale.x = shadowX * factor;
        sprite.shadow.scale.z = shadowZ * factor;
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
      free[actor.kind].push(actor);
    },
  };
}

// How far a lingering mark has faded out: 1 while it shows, falling to 0
// over MARK_FADE_MS once it ends.
function markFade(mark, time) {
  return Number.isNaN(mark.endStart) ? 1 : 1 - (time - mark.endStart) / MARK_FADE_MS;
}

// The announced Wind Dash: a pale blue whirl decal and swirling particles
// around the source stone, and a pulsing red translucent frame decal on the
// target cell, from 'dashAnnounced' until the dash resolves, fails or the
// game ends.
function createDashMark({ world, pool, sp, random, u, frame }) {
  const make = (art, order) => {
    const mesh = createCellDecal(decalMaterial(artSource(art)));
    mesh.renderOrder = order;
    world.scene.add(mesh);
    return mesh;
  };
  const target = make(ART.decal.dashTarget, 3);
  const whirl = make(ART.decal.whirl, 5);
  // endStart is NaN while the mark shows; carry is the emission remainder.
  const mark = { active: false, endStart: NaN, x: 0.5, z: 0.5, carry: 0.5 };

  const hide = () => {
    mark.active = false;
    mark.endStart = NaN;
    target.visible = false;
    whirl.visible = false;
  };

  return {
    show(from, to) {
      placeOnCell(target, to.x, to.y);
      placeOnCell(whirl, from.x, from.y);
      mark.x = whirl.position.x;
      mark.z = whirl.position.z;
      mark.carry = 0;
      target.visible = true;
      whirl.visible = true;
      mark.active = true;
      mark.endStart = NaN;
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
      whirl.material.opacity = fade;
      if (fade < 1) return; // ending: no new swirl
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
        sp.color = i % 3 ? COLORS.swirl : COLORS.wind;
        sp.alpha = 0.85;
        sp.shape = i % 4 ? SHAPE_SQUARE : SHAPE_PLUS;
        pool.spawnSpiral(sp);
      }
    },

    reset: hide,
  };
}

// The announced Tornado Zone: translucent wind decals on the zone cells
// (clipped at the board edges) and a column of particles swirling up over
// the zone centre, from 'tornadoAnnounced' until it ends.
function createTornadoColumn({ world, pool, sp, random, u, frame }) {
  const material = decalMaterial(artSource(ART.decal.zone));
  const decals = [];
  for (let i = 0; i < TORNADO_SIZE * TORNADO_SIZE; i++) {
    const mesh = createCellDecal(material);
    mesh.renderOrder = 1;
    world.scene.add(mesh);
    decals.push(mesh);
  }
  const mark = { active: false, endStart: NaN, x: 0.5, z: 0.5, carry: 0.5 };

  const hide = () => {
    mark.active = false;
    mark.endStart = NaN;
    for (const mesh of decals) mesh.visible = false;
  };

  return {
    show({ x, y, cells }) {
      for (let i = 0; i < decals.length; i++) {
        const cell = cells[i];
        decals[i].visible = Boolean(cell);
        if (cell) placeOnCell(decals[i], cell.x, cell.y);
      }
      const centre = cellToWorld(x, y);
      mark.x = centre.x;
      mark.z = centre.z;
      mark.carry = 0;
      mark.active = true;
      mark.endStart = NaN;
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
      material.opacity = fade * (0.8 + 0.2 * Math.sin(frame.time / 260));
      if (fade < 1) return; // ending: no new wind
      const count = emit(mark, TORNADO_PARTICLE_RATE * frame.scale, frame.dtS);
      for (let i = 0; i < count; i++) {
        random.fill(u);
        // Mostly pale wind, with the odd spring petal or leaf caught up in it.
        const roll = u[0];
        sp.x = mark.x;
        sp.y = 0.02 + u[1] * 0.23;
        sp.z = mark.z;
        sp.radius = 0.25 + u[2] * 0.85;
        sp.angle = u[3] * TWO_PI;
        sp.spin = 4.5 + u[4] * 2.5;
        sp.rise = 1 + u[5] * 0.8;
        sp.widen = 0.3 + u[6] * 0.25;
        sp.life = 1.3 + u[7] * 0.7;
        sp.size = (2 + u[8] * 2) * PX;
        sp.grow = PX;
        sp.color = roll < 0.06 ? COLORS.petal : roll < 0.1 ? COLORS.leaf : roll < 0.55 ? COLORS.wind : COLORS.windBlue;
        sp.alpha = roll < 0.1 ? 0.95 : 0.5;
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
    uniforms: { uScale: { value: 1 } },
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
      varying vec3 vColor;
      varying float vAlpha;
      varying float vShape;
      void main() {
        vec2 p = abs(gl_PointCoord - 0.5);
        if (vShape > 0.5 && min(p.x, p.y) > 0.17) discard; // plus-shaped twinkle
        gl_FragColor = vec4(pow(vColor, vec3(2.2)), vAlpha); // sRGB colours to linear
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
