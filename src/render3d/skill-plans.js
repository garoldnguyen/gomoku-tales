// The pure plans of the Free Action effects of Earth Bear and Wind Rabbit
// (docs/free-action-design.md section 8): the Mud Trap puddle forming, a seed
// sinking into it and surfacing out of the dried mud, a drying puddle, a
// Petrification, the Tornado storm that reveals the cross, and the secret
// cross the caster sees, and the Venom effects: the sap drops falling onto
// the target plant with the plots of the zone turning, and the zone thinning
// away. Each builder is called once when its event arrives
// (effects3d.js start) and returns a frozen list of particle steps in the
// shape of the placement plans (character-look.js): world units relative to
// the plot centre (x right, y up, z toward the viewer) and ms from the event,
//   { kind, particle, startMs, durationMs, from: [x, y, z], to: [x, y, z], height?, tone, ... }
// A spiral step (spiral: true) circles the ground point from[0], from[2]
// instead of flying to `to`: radius, angle, spin (radians a second), rise and
// widen (world units a second). The same list type runs through
// placement-runs.js, so every step plays exactly once. The look of each kind
// is in STEP_LOOKS (data only; effects3d.js draws it).
//
// Counts are the full counts of src/config.js scaled by the quality level
// (particleScale: Low none, Medium few, High all) and never more than the
// level's particleCap in one plan. The same inputs always give the same plan
// (a seeded random generator). No DOM or Three.js, so it runs under node.

import {
  CELL_SIZE, DRY_CRUMBS, DRY_DUST_COUNT, DRY_MS, MUD_FORM_BUBBLES, MUD_FORM_FLECKS, MUD_FORM_MS, MUD_SPLASH_COUNT,
  PETRIFY_CHIP_COUNT, PETRIFY_DUST_COUNT, PETRIFY_MOTE_COUNT, PETRIFY_SHATTER_MS, PETRIFY_WRAP_MS, POISON_END_FOG,
  POISON_FORM_BUBBLES, POISON_FORM_FOG, POISON_FORM_MS, POISON_SAP_DROPS, POISON_SPLASH_COUNT, SINK_DELAY_MS, SINK_MS,
  STORM_BURST_COUNT, STORM_CELL_COUNT, STORM_MS, STORM_SPIN, TORNADO_CROSS_OPACITY, TORNADO_PETAL_OPACITY, TORNADO_PETAL_RATE,
  VENOM_DROP_MS,
} from '../config.js';
import { zoneVisible } from './effect-plans.js';
import { scaledCount } from './particle-pool.js';
import { particleScale, qualityFeatures } from './quality.js';
import { seededRandom } from './seeded-random.js';
import { WIND_GROUND } from './wind.js';

export const SKILL_PLAN_SEED = 20261010;
const TWO_PI = Math.PI * 2;

// How many plans were built, so a test can check that a plan is made once per
// event and never on a frame.
export const planStats = { built: 0 };

// The look of every step kind: size and growth in art pixels, the colours a
// step picks from by its `tone`, the opacity, and whether it is a plus-shaped
// twinkle (otherwise a solid pixel).
export const STEP_LOOKS = Object.freeze({
  mudBubble: Object.freeze({ sizePx: 2, growPx: 1.5, colours: Object.freeze([0xb08a58, 0x8a6338, 0xd2b07a]), alpha: 0.9, plus: false }),
  mudFleck: Object.freeze({ sizePx: 2, growPx: 0, colours: Object.freeze([0x6b4a2b, 0x523720, 0x8a6338]), alpha: 1, plus: false }),
  crust: Object.freeze({ sizePx: 2, growPx: 0, colours: Object.freeze([0xcaa66a, 0xa98650, 0x8a6a3c]), alpha: 1, plus: false }),
  dust: Object.freeze({ sizePx: 3, growPx: 3, colours: Object.freeze([0xd8c9a8, 0xb8a888, 0xe6dcc2]), alpha: 0.55, plus: false }),
  earthMote: Object.freeze({ sizePx: 3, growPx: 0, colours: Object.freeze([0xffd84a, 0xfff2b0, 0xe0a030]), alpha: 0.95, plus: true }),
  mossMote: Object.freeze({ sizePx: 2, growPx: 0, colours: Object.freeze([0x7ccf5a, 0x4fa044, 0xa8e07c]), alpha: 0.95, plus: false }),
  stoneChip: Object.freeze({ sizePx: 3, growPx: 0, colours: Object.freeze([0x9a9aa6, 0x6e6e7a, 0xc4c4cc, 0x6cc04a]), alpha: 1, plus: false }),
  whirlFluff: Object.freeze({ sizePx: 2, growPx: 0.4, colours: Object.freeze([0xfff6ec, 0xffffff, 0xffe066]), alpha: 0.95, plus: true }),
  whirlLeaf: Object.freeze({ sizePx: 2, growPx: 0, colours: Object.freeze([0x6cc04a, 0xbfe0ff, 0x4fa044]), alpha: 0.9, plus: false }),
  // Venom: deep purple sap, a sickly green toxic bubble, a low purple grey fog.
  sapDrop: Object.freeze({ sizePx: 3, growPx: 0, colours: Object.freeze([0x7b3fb0, 0x9b59d6, 0xc9a0ff]), alpha: 1, plus: false }),
  sapSplash: Object.freeze({ sizePx: 2, growPx: 0, colours: Object.freeze([0x9b59d6, 0x7b3fb0, 0x8cff5a]), alpha: 0.95, plus: false }),
  toxicBubble: Object.freeze({ sizePx: 2, growPx: 1.5, colours: Object.freeze([0x8cff5a, 0xb48cff, 0x5fd04a]), alpha: 0.9, plus: false }),
  poisonFog: Object.freeze({ sizePx: 5, growPx: 4, colours: Object.freeze([0xb9a2d6, 0x9c82c0, 0xd2c2e6]), alpha: 0.38, plus: false }),
});

// A wisp of the zone starts within FOG_SPREAD of its plot's middle and drifts
// at most FOG_DRIFT along the wind, which together stays inside the plot (half
// a cell is 0.5): no plan step ever reaches a neighbouring plot, which may be
// covered for the viewer.
const FOG_SPREAD = 0.2;
const FOG_DRIFT = 0.3;

// The height the sap drops start at (world units over the target plot) and the
// height of the plant's head they land on.
export const SAP_START_HEIGHT = 2.6;
export const SAP_LAND_HEIGHT = 0.45;

// The faint petals drifting over the caster's cross (not a plan step: the
// swirl emits them while the cross shows).
export const CROSS_PETAL_COLOURS = Object.freeze([0x6fb4ff, 0x9cc8ff, 0xc4e0ff]);

function between(random, min, max) {
  return min + random() * (max - min);
}

// The particles a plan may still draw: `left` is what the level's cap allows,
// `scale` the share of the full counts the level draws.
function budgetOf(features) {
  return { left: Math.max(0, Math.floor(features.particleCap ?? 0)), scale: particleScale(features) };
}

// How many of `base` (the full count) to draw at this level; spends the budget.
function want(budget, base) {
  const count = Math.min(budget.left, scaledCount(base, budget.scale));
  budget.left -= count;
  return count;
}

function freezeStep(step) {
  Object.freeze(step.from);
  if (step.to) Object.freeze(step.to);
  return Object.freeze(step);
}

// Runs `make(random, budget)` for the level of options.features and returns
// its steps frozen. options.seed varies the plan (the plot it is for).
function build(options, make) {
  const features = options?.features ?? qualityFeatures();
  const random = seededRandom(options?.seed ?? SKILL_PLAN_SEED);
  const steps = make(random, budgetOf(features)).map(freezeStep);
  planStats.built++;
  return Object.freeze(steps);
}

function fly(kind, startMs, durationMs, from, to, tone, height = 0) {
  return { kind, particle: true, startMs: Math.round(startMs), durationMs: Math.round(durationMs), from, to, height, tone };
}

function rise(kind, startMs, durationMs, x, z, lift, tone, drift = 0) {
  return fly(kind, startMs, durationMs, [x, 0.03, z], [x + drift * WIND_GROUND.x, 0.03 + lift, z + drift * WIND_GROUND.z], tone);
}

function spiral(kind, startMs, durationMs, around, params, tone) {
  return {
    kind, particle: true, spiral: true, startMs: Math.round(startMs), durationMs: Math.round(durationMs),
    from: [around[0], around[1], around[2]], radius: params.radius, angle: params.angle, spin: params.spin, rise: params.rise,
    widen: params.widen, tone,
  };
}

const toneOf = (random, kind) => Math.floor(random() * STEP_LOOKS[kind].colours.length);

// Mud Trap (event mudPlaced): soil flecks cave into the middle of the plot
// while bubbles pop up in the spreading puddle.
export function mudFormPlan(options) {
  return build(options, (random, budget) => {
    const steps = [];
    const flecks = want(budget, MUD_FORM_FLECKS);
    for (let i = 0; i < flecks; i++) {
      const angle = ((i + random() * 0.6) / flecks) * TWO_PI;
      steps.push(fly('mudFleck', random() * MUD_FORM_MS * 0.4, between(random, 260, 380),
        [Math.cos(angle) * 0.42, 0.14, Math.sin(angle) * 0.42], [Math.cos(angle) * 0.06, 0, Math.sin(angle) * 0.06],
        toneOf(random, 'mudFleck'), between(random, 0.1, 0.2)));
    }
    const bubbles = want(budget, MUD_FORM_BUBBLES);
    for (let i = 0; i < bubbles; i++) {
      const angle = random() * TWO_PI;
      const reach = Math.sqrt(random()) * 0.33;
      steps.push(rise('mudBubble', MUD_FORM_MS * 0.2 + (i / Math.max(1, bubbles)) * MUD_FORM_MS * 0.9 + random() * 40,
        between(random, 380, 620), Math.cos(angle) * reach, Math.sin(angle) * reach, between(random, 0.14, 0.26),
        toneOf(random, 'mudBubble')));
    }
    return steps;
  });
}

// Mud Trap (event stoneSunk): when the seed starts to sink, mud flecks are
// thrown up round it and bubbles rise from where it went down.
export function seedSinkPlan(options) {
  return build(options, (random, budget) => {
    const steps = [];
    const splash = want(budget, MUD_SPLASH_COUNT);
    for (let i = 0; i < splash; i++) {
      const angle = ((i + random() * 0.6) / splash) * TWO_PI;
      const reach = between(random, 0.3, 0.55);
      steps.push(fly('mudFleck', SINK_DELAY_MS + random() * 60, between(random, 380, 520),
        [Math.cos(angle) * 0.1, 0.05, Math.sin(angle) * 0.1], [Math.cos(angle) * reach, 0, Math.sin(angle) * reach],
        toneOf(random, 'mudFleck'), between(random, 0.25, 0.5)));
    }
    const bubbles = want(budget, 6);
    for (let i = 0; i < bubbles; i++) {
      steps.push(rise('mudBubble', SINK_DELAY_MS + (i / Math.max(1, bubbles)) * SINK_MS, between(random, 380, 560),
        between(random, -0.1, 0.1), between(random, -0.1, 0.1), between(random, 0.15, 0.3), toneOf(random, 'mudBubble')));
    }
    return steps;
  });
}

// Mud Trap (event stoneSurfaced): the dried crust breaks and crumbs fly while
// dust rises, as the sprout pops up.
export function seedSurfacePlan(options) {
  return build(options, (random, budget) => {
    const steps = [];
    const crumbs = want(budget, DRY_CRUMBS);
    for (let i = 0; i < crumbs; i++) {
      const angle = ((i + random() * 0.6) / crumbs) * TWO_PI;
      const reach = between(random, 0.3, 0.6);
      steps.push(fly('crust', random() * 60, between(random, 420, 580),
        [Math.cos(angle) * 0.1, 0.1, Math.sin(angle) * 0.1], [Math.cos(angle) * reach, 0, Math.sin(angle) * reach],
        toneOf(random, 'crust'), between(random, 0.3, 0.55)));
    }
    const dust = want(budget, DRY_DUST_COUNT);
    for (let i = 0; i < dust; i++) {
      steps.push(rise('dust', random() * 220, between(random, 700, 1000), between(random, -0.25, 0.25),
        between(random, -0.25, 0.25), between(random, 0.4, 0.8), toneOf(random, 'dust'), between(random, 0.2, 0.5)));
    }
    return steps;
  });
}

// Mud Trap (event mudDried): an unused puddle dries, cracks and crumbles; a
// little dust rises off it while the crust fades.
export function mudDryPlan(options) {
  return build(options, (random, budget) => {
    const steps = [];
    const crumbs = want(budget, Math.ceil(DRY_CRUMBS / 2));
    for (let i = 0; i < crumbs; i++) {
      const angle = random() * TWO_PI;
      const reach = between(random, 0.15, 0.4);
      steps.push(fly('crust', random() * DRY_MS * 0.5, between(random, 360, 520),
        [Math.cos(angle) * 0.05, 0.05, Math.sin(angle) * 0.05], [Math.cos(angle) * reach, 0, Math.sin(angle) * reach],
        toneOf(random, 'crust'), between(random, 0.12, 0.25)));
    }
    const dust = want(budget, DRY_DUST_COUNT);
    for (let i = 0; i < dust; i++) {
      steps.push(rise('dust', random() * DRY_MS * 0.6, between(random, 800, 1100), between(random, -0.3, 0.3),
        between(random, -0.3, 0.3), between(random, 0.3, 0.6), toneOf(random, 'dust'), between(random, 0.2, 0.5)));
    }
    return steps;
  });
}

// Petrification (event stonePetrified): gold and green earth energy winds up
// round the plant while its colour drains; grey chips burst out as it shatters;
// dust rises off the new rock. Times follow PETRIFY_* (petrifyPose).
export function petrifyPlan(options) {
  return build(options, (random, budget) => {
    const steps = [];
    const motes = want(budget, PETRIFY_MOTE_COUNT);
    for (let i = 0; i < motes; i++) {
      const gold = i % 2 === 0;
      steps.push(spiral(gold ? 'earthMote' : 'mossMote', (i / Math.max(1, motes)) * PETRIFY_WRAP_MS * 0.85 + random() * 20,
        between(random, 460, 600), [0, 0.02 + random() * 0.1, 0], {
          radius: between(random, 0.42, 0.52), angle: random() * TWO_PI, spin: between(random, 7, 10),
          rise: between(random, 0.9, 1.4), widen: between(random, -0.35, -0.2),
        }, toneOf(random, gold ? 'earthMote' : 'mossMote')));
    }
    const chips = want(budget, PETRIFY_CHIP_COUNT);
    for (let i = 0; i < chips; i++) {
      const angle = ((i + random() * 0.6) / chips) * TWO_PI;
      const reach = between(random, 0.35, 0.7);
      steps.push(fly('stoneChip', PETRIFY_WRAP_MS + random() * 40, between(random, 420, 620),
        [Math.cos(angle) * 0.08, 0.28, Math.sin(angle) * 0.08], [Math.cos(angle) * reach, 0, Math.sin(angle) * reach],
        toneOf(random, 'stoneChip'), between(random, 0.3, 0.6)));
    }
    const dust = want(budget, PETRIFY_DUST_COUNT);
    for (let i = 0; i < dust; i++) {
      steps.push(rise('dust', PETRIFY_WRAP_MS + PETRIFY_SHATTER_MS + random() * 200, between(random, 800, 1200),
        between(random, -0.2, 0.2), between(random, -0.2, 0.2), between(random, 0.6, 1.1), toneOf(random, 'dust'),
        between(random, 0.4, 0.9)));
    }
    return steps;
  });
}

// Tornado Zone (event tornadoStorm): the fired trap reveals the cross as a
// whirlwind. `cells` are the cross cells, `x` and `y` its centre (the event's
// own), where the plan's origin is: fluff and leaves whirl up from the centre
// first, then round every cell of the cross.
export function stormPlan(spec, options) {
  return build(options, (random, budget) => {
    const steps = [];
    const burst = want(budget, STORM_BURST_COUNT);
    for (let i = 0; i < burst; i++) {
      const fluff = random() < 0.7;
      const kind = fluff ? 'whirlFluff' : 'whirlLeaf';
      steps.push(spiral(kind, random() * 120, between(random, 1100, 1800), [0, 0.02 + random() * 0.3, 0], {
        radius: between(random, 0.15, 1.05), angle: random() * TWO_PI, spin: between(random, 6, 10),
        rise: between(random, 1.4, 2.6), widen: between(random, 1.1, 2.2),
      }, toneOf(random, kind)));
    }
    const cells = spec.cells ?? [];
    for (let c = 0; c < cells.length; c++) {
      const around = [(cells[c].x - spec.x) * CELL_SIZE, 0, (cells[c].y - spec.y) * CELL_SIZE];
      const count = want(budget, STORM_CELL_COUNT);
      for (let i = 0; i < count; i++) {
        const fluff = random() < 0.65;
        const kind = fluff ? 'whirlFluff' : 'whirlLeaf';
        steps.push(spiral(kind, (i / Math.max(1, count)) * STORM_MS * 0.6 + random() * 40, between(random, 700, 1100),
          [around[0], 0.02 + random() * 0.2, around[2]], {
            radius: between(random, 0.1, 0.45), angle: random() * TWO_PI, spin: STORM_SPIN * between(random, 0.8, 1.2),
            rise: between(random, 0.7, 1.4), widen: between(random, 0.1, 0.3),
          }, toneOf(random, kind)));
      }
    }
    return steps;
  });
}

// The caster's reminder of the secret cross (the zone of the viewer's own
// state): the cells with their place in the 3 by 3 art (decal-zone-cross), and
// the faint petals that drift over them. null unless this viewer may see the
// zone: the other seat's copy of it is hidden, with no cells, so nothing of
// the cross is ever planned for it. Only the owner and spectators get a plan.
export function tornadoCrossPlan(zone) {
  if (!zoneVisible(zone)) return null;
  const pieces = zone.cells.map((cell) => Object.freeze({ x: cell.x, y: cell.y, dx: cell.x - zone.x, dy: cell.y - zone.y }));
  planStats.built++;
  return Object.freeze({
    x: zone.x,
    y: zone.y,
    pieces: Object.freeze(pieces),
    opacity: TORNADO_CROSS_OPACITY,
    petalRate: TORNADO_PETAL_RATE,
    petalOpacity: TORNADO_PETAL_OPACITY,
  });
}

// The offsets (world units from the plan's origin plot) of the zone cells a
// plan is for: [{ x, y }] cells and the origin cell (x, y).
function cellOffset(cell, spec) {
  return [(cell.x - spec.x) * CELL_SIZE, (cell.y - spec.y) * CELL_SIZE];
}

// Venom (event poisonPlaced): sap drops fall from the sky onto the target
// plant (x, y) one after another during VENOM_DROP_MS and splash off it, then
// the plots of the zone turn: toxic bubbles pop and low fog rises on each cell
// of `spec.cells` over POISON_FORM_MS. The plan only names the cells it is
// given (effects3d.js passes the ones the viewer may see, and none of the
// target's drops when the viewer cannot see the target plot: spec.target is
// false), so a covered plot is never named. Origin: the target plot.
export function venomPlan(spec, options) {
  return build(options, (random, budget) => {
    const steps = [];
    const drops = spec.target === false ? 0 : want(budget, POISON_SAP_DROPS);
    for (let i = 0; i < drops; i++) {
      const fall = between(random, 230, 290);
      const landAt = Math.max(fall, ((i + 1) / drops) * VENOM_DROP_MS);
      steps.push(fly('sapDrop', landAt - fall, fall, [between(random, -0.07, 0.07), SAP_START_HEIGHT + i * 0.1, between(random, -0.05, 0.05)],
        [between(random, -0.05, 0.05), SAP_LAND_HEIGHT, between(random, -0.04, 0.04)], toneOf(random, 'sapDrop')));
    }
    const splash = spec.target === false ? 0 : want(budget, POISON_SPLASH_COUNT);
    for (let i = 0; i < splash; i++) {
      const angle = ((i + random() * 0.6) / splash) * TWO_PI;
      const reach = between(random, 0.2, 0.45);
      steps.push(fly('sapSplash', VENOM_DROP_MS + random() * 50, between(random, 320, 460),
        [Math.cos(angle) * 0.05, SAP_LAND_HEIGHT * 0.6, Math.sin(angle) * 0.05], [Math.cos(angle) * reach, 0.03, Math.sin(angle) * reach],
        toneOf(random, 'sapSplash'), between(random, 0.15, 0.3)));
    }
    const cells = spec.cells ?? [];
    for (let c = 0; c < cells.length; c++) {
      const [ox, oz] = cellOffset(cells[c], spec);
      const fog = want(budget, POISON_FORM_FOG);
      for (let i = 0; i < fog; i++) {
        steps.push(rise('poisonFog', VENOM_DROP_MS + random() * POISON_FORM_MS * 0.6, between(random, 1100, 1600),
          ox + between(random, -FOG_SPREAD, FOG_SPREAD), oz + between(random, -FOG_SPREAD, FOG_SPREAD), between(random, 0.1, 0.22),
          toneOf(random, 'poisonFog'), between(random, 0.1, FOG_DRIFT)));
      }
      const bubbles = want(budget, POISON_FORM_BUBBLES);
      for (let i = 0; i < bubbles; i++) {
        steps.push(rise('toxicBubble', VENOM_DROP_MS + random() * POISON_FORM_MS, between(random, 420, 640),
          ox + between(random, -0.3, 0.3), oz + between(random, -0.3, 0.3), between(random, 0.14, 0.28), toneOf(random, 'toxicBubble')));
      }
    }
    return steps;
  });
}

// Venom (event poisonEnded): the zone thins away. `spec.cells` are the plots it
// showed (the empty ones the viewer saw) and (spec.x, spec.y) the origin plot:
// fog wisps lift off each of them and drift away on the wind, and a last bubble
// or two pops.
export function poisonEndPlan(spec, options) {
  return build(options, (random, budget) => {
    const steps = [];
    const cells = spec.cells ?? [];
    for (let c = 0; c < cells.length; c++) {
      const [ox, oz] = cellOffset(cells[c], spec);
      const fog = want(budget, POISON_END_FOG);
      for (let i = 0; i < fog; i++) {
        steps.push(rise('poisonFog', random() * 300, between(random, 800, 1200), ox + between(random, -FOG_SPREAD, FOG_SPREAD),
          oz + between(random, -FOG_SPREAD, FOG_SPREAD), between(random, 0.25, 0.5), toneOf(random, 'poisonFog'),
          between(random, 0.2, FOG_DRIFT)));
      }
      if (want(budget, 1) === 1) {
        steps.push(rise('toxicBubble', random() * 300, between(random, 380, 560), ox + between(random, -0.25, 0.25),
          oz + between(random, -0.25, 0.25), between(random, 0.14, 0.25), toneOf(random, 'toxicBubble')));
      }
    }
    return steps;
  });
}

// How many steps of a plan are particles.
export function particleSteps(plan) {
  let count = 0;
  for (const step of plan) if (step.particle) count++;
  return count;
}
