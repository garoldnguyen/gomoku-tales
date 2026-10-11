// Pure planning and timing for the 3D effects (docs/art-direction-v3.md
// sections 4 and 9): which visuals the logic events show, which board cells
// keep their plant hidden while a flying seed is on its way there and when
// that plant regrows from Land, the shape of every skill animation over
// time (reverse growth, the Wind Dash gust curve, the thrown seed's spin and
// arc, the puddle spreading, a seed sinking and surfacing, the drying crust,
// a Petrification, the conversion spark), and the camera shake. Effects only
// follow the events returned by src/logic; nothing here feeds back into the
// rules. No DOM or Three.js, so it runs under node --test. The pose and
// shake functions read their time from, and write their results into, one
// object the caller keeps (pose.ageMs in, the pose out), so the per-frame
// animation never allocates or passes loose numbers around.

import {
  CLOUD_FADE_MS, CLOUD_FORM_MS, CLOUD_LIGHTNING_CHANCE, CLOUD_LIGHTNING_GAP_MS, CLOUD_LIGHTNING_MS, CLOUD_LIGHTNING_PULSE_MS,
  CONVERT_SPARK_MS, DASH_CURVE, DASH_LIFT, DASH_STREAK_MS, DRY_MS, MUD_FORM_FROM, MUD_FORM_MS,
  PETRIFY_FLICKER_FROM, PETRIFY_FLICKER_STEPS, PETRIFY_GREY_FROM, PETRIFY_SETTLE_MS, PETRIFY_SHATTER_MS, PETRIFY_SQUASH,
  PETRIFY_WRAP_MS, REVERSE_GROWTH_SPEED, SHAKE3D_LIGHT, SHAKE3D_MS, SINK_DELAY_MS, SINK_MS, SKY_WATCH_PULSE_LOW,
  SKY_WATCH_PULSE_MS, SURFACE_MS, SURFACE_OVERSHOOT, SURFACE_POP_AT, THROW_ARC_HEIGHT, THROW_ARC_MAX, THROW_ARC_PER_PLOT, THROW_DELAY_MS, THROW_DROP_MS,
  THROW_MS, THROW_MS_MAX, THROW_MS_PER_PLOT, THROW_SPIN_LIFT, THROW_SPIN_MS, THROW_SPIN_TURNS, POISON_FADE_MS, POISON_FORM_MS, VENOM_DROP_MS,
  VENOM_WILT_HOLD_MS, VENOM_WILT_IN_MS, VENOM_WILT_OUT_MS,
} from '../config.js';
import { TORNADO_ZONE } from '../logic/skills.js';
import { bannerTexts } from '../render/effects.js';
import { dropOffsetPx, STAGE_DROP, STAGE_LAND, STAGE_REST, STAGE_SPROUT } from './growth.js';

// Visual specs for the events of one action, in order:
//   { kind: 'place', x, y, player }       a seed planted (its growth cues are the piece layer's)
//   { kind: 'dashMark', from, to, player } petals circle the source, red brackets on the target, until the dash ends
//   { kind: 'dashStreak', from, to, player } the source bloom folds into a seed that rides a gust of
//                                         petals along a curve to the target and regrows there from Land
//   { kind: 'dashFizzle', from, to }      a failed dash: the mark ends with a puff
//   { kind: 'tornado', x, y, cells, player }  the caster's reminder of the secret cross: faint blue petals over its cells,
//                                         until it ends (the other seat gets nothing at all: no spec)
//   { kind: 'storm', x, y, cells }        the trap fired: the cross is revealed as a whirlwind (centre x, y)
//   { kind: 'tornadoEnd' }
//   { kind: 'throw', from, to, player }   a seed spun up by the whirlwind and thrown in an arc, landing with a dust puff,
//                                         then regrowing from Land
//   { kind: 'throwBlocked', x, y }        a gust around a plant with nowhere to go
//   { kind: 'mudForm', x, y, player }     the plot sinks into a bubbling brown puddle
//   { kind: 'seedSink', x, y, player }    the new seed sinks below the ground, drawn dim
//   { kind: 'seedSurface', x, y, player } the mud dries and cracks and the sprout pops up
//   { kind: 'mudDry', x, y, player }      an unused puddle dries, cracks and fades
//   { kind: 'petrify', x, y, player, from } earth energy wraps the plant of `from`, its colour drains to grey, it
//                                         shatters into a mossy rock with dust rising (the rock then stays)
//   { kind: 'castRing', x, y, player }    a ring in the character's colour spreads from a skill's
//                                         target plot (every skill with a plot target; Wind Dash
//                                         from its source plant)
//   { kind: 'hiss', player, locked }      wavy jade sound rings cross the field from its middle
//   { kind: 'venom', x, y, player, cells } venom sap drops fall from the sky onto the target plant (x, y), which wilts a
//                                         little and stays; the empty plots of the zone (`cells`) turn withered purple
//                                         under low fog and toxic bubbles (the zone itself is drawn from state.poison)
//   { kind: 'poisonEnd', player }         the zone is over: it thins away over the plots it showed
//   { kind: 'cloudForm', x, y, player }   the cloud thickens from nothing as puffs roll in on the wind
//   { kind: 'cloudFade', x, y, player }   the ended cloud thins away as puffs drift off on the wind
//   { kind: 'winBloom', line, player }    each winning plant in turn sends a ring and twinkles in the
//                                         winner's colour
//   { kind: 'endLingering' }              the game is over: marks and columns end
//   { kind: 'banner', text }              HUD banner text (same texts as the 2D game)
// Only cells an event names directly are used, so an event the cloud
// masking left in (src/logic/cloud.js maskEventsForViewer) never shows a
// covered plot.
export function visualsForEvents(events) {
  const specs = [];
  for (const event of events) {
    switch (event.type) {
      case 'skillUsed': {
        const target = event.target;
        // A Tornado Zone is secret: its swirl follows the viewer's state
        // (effects.syncTornado), but a cast ring and its twinkles would keep
        // playing round the secret centre after the turn passes to the other
        // seat, so that skill plays none.
        if (event.skill !== TORNADO_ZONE && Number.isInteger(target?.x) && Number.isInteger(target?.y)) {
          specs.push({ kind: 'castRing', x: target.x, y: target.y, player: event.player });
        }
        break;
      }
      case 'hissCast':
        specs.push({ kind: 'hiss', player: event.player, locked: event.locked });
        break;
      // The zone itself is drawn from state.poison (board-marks.js,
      // poison-effects.js); the events start the sap drops and the turning
      // of its plots, and its thinning away. The cast ring comes from the
      // skillUsed event.
      case 'poisonPlaced':
        specs.push({ kind: 'venom', x: event.x, y: event.y, player: event.player, cells: event.cells ?? [] });
        break;
      case 'poisonEnded':
        specs.push({ kind: 'poisonEnd', player: event.player });
        break;
      case 'cloudPlaced':
        specs.push({ kind: 'cloudForm', x: event.x, y: event.y, player: event.player });
        break;
      case 'cloudEnded':
        specs.push({ kind: 'cloudFade', x: event.x, y: event.y, player: event.player });
        break;
      case 'stonePlaced':
        specs.push({ kind: 'place', x: event.x, y: event.y, player: event.player });
        break;
      case 'dashAnnounced':
        specs.push({ kind: 'castRing', x: event.from.x, y: event.from.y, player: event.player });
        specs.push({ kind: 'dashMark', from: event.from, to: event.to, player: event.player });
        break;
      case 'dashResolved':
        specs.push({ kind: 'dashStreak', from: event.from, to: event.to, player: event.player });
        break;
      case 'dashFailed':
        specs.push({ kind: 'dashFizzle', from: event.from, to: event.to });
        break;
      case 'tornadoAnnounced':
        // The other seat sees NOTHING on the board (docs/free-action-design.md
        // section 8): the announcement it gets is hidden and plays no visual.
        if (!event.hidden) specs.push({ kind: 'tornado', x: event.x, y: event.y, cells: event.cells, player: event.player });
        break;
      case 'tornadoStorm':
        specs.push({ kind: 'storm', x: event.x, y: event.y, cells: event.cells ?? [{ x: event.x, y: event.y }] });
        break;
      case 'tornadoEnded':
        specs.push({ kind: 'tornadoEnd' });
        break;
      case 'stoneThrown':
        specs.push({ kind: 'throw', from: event.from, to: event.to, player: event.player });
        break;
      case 'throwBlocked':
        specs.push({ kind: 'throwBlocked', x: event.x, y: event.y });
        break;
      case 'stonePetrified':
        specs.push({ kind: 'petrify', x: event.x, y: event.y, player: event.player, from: event.from });
        break;
      case 'mudPlaced':
        specs.push({ kind: 'mudForm', x: event.x, y: event.y, player: event.player });
        break;
      case 'stoneSunk':
        specs.push({ kind: 'seedSink', x: event.x, y: event.y, player: event.player });
        break;
      case 'stoneSurfaced':
        specs.push({ kind: 'seedSurface', x: event.x, y: event.y, player: event.player });
        break;
      case 'mudDried':
        specs.push({ kind: 'mudDry', x: event.x, y: event.y, player: event.player });
        break;
      case 'win':
      case 'draw':
        if (event.type === 'win' && Array.isArray(event.line) && event.line.length > 0) {
          specs.push({ kind: 'winBloom', line: event.line, player: event.player });
        }
        // A win drops a pending dash and the zone without their own events.
        specs.push({ kind: 'endLingering' });
        break;
    }
  }
  for (const text of bannerTexts(events)) specs.push({ kind: 'banner', text });
  return specs;
}

// True when the drawn state's Tornado Zone is one the viewer may see: it
// exists and carries its cells (the other seat's copy is { hidden: true } with
// no cells, see maskForViewer in logic/cloud.js). The renderer keeps the
// swirl in step with this every frame, so a secret zone is gone the moment
// the viewer may no longer see it, whatever the events said. Allocation
// free: it runs on the frame path.
export function zoneVisible(zone) {
  return zone != null && zone.hidden !== true && zone.cells != null;
}

// The visuals for events that piled up while the page was hidden (see
// frame-gap.js): only where the lingering marks end up, with no sparkles,
// flights, shakes or banners. At most one spec for the Wind Dash marks
// ('dashMark' to show them, 'dashClear' to hide them at once) and one for
// the Tornado Zone ('tornado' or 'tornadoClear'), each left out if no event
// touched it.
export function catchUpVisuals(events) {
  let dash; // undefined: untouched
  let tornado;
  for (const spec of visualsForEvents(events)) {
    switch (spec.kind) {
      case 'dashMark':
        dash = spec;
        break;
      case 'dashStreak':
      case 'dashFizzle':
        dash = null;
        break;
      case 'tornado':
        tornado = spec;
        break;
      case 'tornadoEnd':
      case 'storm': // a fired trap is used up at once
        tornado = null;
        break;
      case 'endLingering':
        dash = null;
        tornado = null;
        break;
    }
  }
  const specs = [];
  if (dash !== undefined) specs.push(dash ?? { kind: 'dashClear' });
  if (tornado !== undefined) specs.push(tornado ?? { kind: 'tornadoClear' });
  return specs;
}

// How long a plant takes to fold back from stage `fromStage` to stage
// `toStage` when its growth plays backwards REVERSE_GROWTH_SPEED times
// faster than it grows (docs/art-direction-v3.md section 4). stageStartMs
// are the plant's stage start times (v3-meta.js stageStartMs).
export function reverseGrowthMs(stageStartMs, fromStage, toStage) {
  return Math.max(0, stageStartMs[fromStage] - stageStartMs[toStage]) / REVERSE_GROWTH_SPEED;
}

// The stage a plant shows pose.ageMs into folding back from `fromStage` to
// `toStage`: the growth timeline played backwards from the start of
// `fromStage`. Writes pose.frame and pose.done (from the end on, where it
// stays on `toStage`).
export function reverseGrowthInto(out, stageStartMs, fromStage, toStage) {
  const age = out.ageMs > 0 ? out.ageMs : 0;
  if (age >= reverseGrowthMs(stageStartMs, fromStage, toStage)) {
    out.frame = toStage;
    out.done = true;
    return out;
  }
  const forward = stageStartMs[fromStage] - age * REVERSE_GROWTH_SPEED;
  let frame = fromStage;
  while (frame > toStage && forward < stageStartMs[frame]) frame--;
  out.frame = frame;
  out.done = false;
  return out;
}

// Wind Dash: the resting bloom folds all the way back into a seed.
export function dashFoldMs(stageStartMs) {
  return reverseGrowthMs(stageStartMs, STAGE_REST, STAGE_DROP);
}

// A plant that changes sides: it wilts back to Sprout, then the spark runs.
export function convertWiltMs(stageStartMs) {
  return reverseGrowthMs(stageStartMs, STAGE_REST, STAGE_SPROUT);
}

export function convertMs(stageStartMs) {
  return convertWiltMs(stageStartMs) + CONVERT_SPARK_MS;
}

// The cell whose plant stays hidden while a flying seed (or the petrified
// plant becoming a rock, or the wilting old plant) shows it arriving, and for
// how long:
// { x, y, ms }, or null. The board already holds the piece; the effect
// shows it arriving. stageStartMs times the reverse growth.
export function heldCell(spec, stageStartMs) {
  switch (spec.kind) {
    case 'throw':
      return { x: spec.to.x, y: spec.to.y, ms: THROW_DELAY_MS + throwFlightMs(spec.from, spec.to) };
    case 'dashStreak':
      return { x: spec.to.x, y: spec.to.y, ms: dashFoldMs(stageStartMs) + DASH_STREAK_MS };
    case 'petrify':
      return { x: spec.x, y: spec.y, ms: petrifyMs() };
    case 'convert':
      return { x: spec.x, y: spec.y, ms: convertMs(stageStartMs) };
    default:
      return null;
  }
}

// The plant that regrows from Land once its held cell shows again (a seed
// that flew there, a converted plant): { x, y, player, startMs }, or null.
// startMs is when, counted from the event, its seed would have been
// planted for it to enter Land just as the hold ends.
export function regrowCell(spec, stageStartMs) {
  let player;
  switch (spec.kind) {
    case 'throw':
    case 'dashStreak':
      player = spec.player;
      break;
    case 'convert':
      player = spec.to;
      break;
    default:
      return null;
  }
  const { x, y, ms } = heldCell(spec, stageStartMs);
  return { x, y, player, startMs: ms - stageStartMs[STAGE_LAND] };
}

// Shake strength in world units for a spec, 0 for none: only a plant
// shattering into a rock shakes, lightly (docs/art-direction-v3.md section 5,
// High only). The Tornado storm shakes by its own call (effects3d.js).
export function shakeStrength(spec) {
  return spec.kind === 'petrify' ? SHAKE3D_LIGHT : 0;
}

const THROW_SPIN_MIN_WIDTH = 0.12; // a spinning seed is never thinner than this share of its width (edge on)
const clamp01 = (t) => Math.min(1, Math.max(0, t));
export const smoothstep = (t) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

// Height of an arc that starts and ends on the ground and peaks at `height`
// halfway.
export function arcHeight(t, height) {
  const u = clamp01(t);
  return 4 * height * u * (1 - u);
}

// A point pose.progress (0 to 1) along the Wind Dash gust from (fx, fz)
// to (tx, tz): a quadratic curve that bows sideways by DASH_CURVE of the
// way's length, rising DASH_LIFT above the board halfway. With `plain`
// (quality.js plainSlides) it is a straight slide along the ground. Writes
// pose.x, pose.z and pose.lift.
export function dashCurveInto(out, fx, fz, tx, tz, plain = false) {
  const u = clamp01(out.progress);
  const dx = tx - fx;
  const dz = tz - fz;
  const bow = plain ? 0 : DASH_CURVE;
  const cx = (fx + tx) / 2 - dz * bow;
  const cz = (fz + tz) / 2 + dx * bow;
  const a = (1 - u) * (1 - u);
  const b = 2 * u * (1 - u);
  const c = u * u;
  out.x = a * fx + b * cx + c * tx;
  out.z = a * fz + b * cz + c * tz;
  out.lift = plain ? 0 : arcHeight(u, DASH_LIFT);
  return out;
}

// Wind Dash pose.ageMs after it resolved: the source bloom folds back into
// a seed (reverse growth, dashFoldMs), then the seed rides the gust for
// DASH_STREAK_MS, easing in and out. pose.frame (the stage shown),
// pose.flying, pose.progress (0 to 1 along the gust), pose.done.
export function dashPose(out, stageStartMs) {
  const { ageMs } = out;
  reverseGrowthInto(out, stageStartMs, STAGE_REST, STAGE_DROP);
  const flight = ageMs - dashFoldMs(stageStartMs);
  out.flying = out.done && flight > 0;
  out.progress = smoothstep(flight / DASH_STREAK_MS);
  out.done = flight >= DASH_STREAK_MS;
  out.ageMs = ageMs;
  return out;
}

// How long a seed thrown from `from` to `to` flies, and how high its arc
// rises: the next plot over takes THROW_MS and THROW_ARC_HEIGHT, and every
// plot farther adds THROW_MS_PER_PLOT and THROW_ARC_PER_PLOT, up to
// THROW_MS_MAX and THROW_ARC_MAX. The Tornado throw can land anywhere on
// the field, so a far throw must not look like a short one sped up. Pure,
// called once per throw.
export function throwFlightMs(from, to) {
  const extra = Math.max(0, Math.hypot(to.x - from.x, to.y - from.y) - 1);
  return Math.min(THROW_MS_MAX, THROW_MS + THROW_MS_PER_PLOT * extra);
}

export function throwArcHeight(from, to) {
  const extra = Math.max(0, Math.hypot(to.x - from.x, to.y - from.y) - 1);
  return Math.min(THROW_ARC_MAX, THROW_ARC_HEIGHT + THROW_ARC_PER_PLOT * extra);
}

// A thrown seed pose.ageMs after it was planted: it drops onto its plot
// for THROW_DROP_MS (pose.dropPx art pixels above it, as a growing seed
// drops), the whirlwind spins it up off its plot for THROW_SPIN_MS (pose.lift
// world units up, pose.spinScale the width it shows turning round and round),
// then it flies in an arc for pose.flightMs (THROW_MS when it is not set, see
// throwFlightMs; with `plain`, quality.js plainSlides, it slides along the
// ground instead and is not lifted). pose.progress along the way, pose.height
// (the arc, pose.arc high at the top, THROW_ARC_HEIGHT when it is not set),
// pose.done. The seed is on its way down from pose.lift to the ground as it
// flies: y = lift * (1 - progress) + height.
export function throwPose(out, plain = false) {
  const { ageMs } = out;
  out.dropPx = dropOffsetPx(ageMs);
  const spin = clamp01((ageMs - THROW_DROP_MS) / THROW_SPIN_MS);
  out.lift = plain ? 0 : THROW_SPIN_LIFT * smoothstep(spin);
  out.spinScale = spin > 0 && spin < 1 ? Math.max(THROW_SPIN_MIN_WIDTH, Math.abs(Math.cos(spin * THROW_SPIN_TURNS * Math.PI * 2))) : 1;
  const flight = out.flightMs > 0 ? out.flightMs : THROW_MS;
  const t = clamp01((ageMs - THROW_DELAY_MS) / flight);
  out.progress = t;
  out.height = plain ? 0 : arcHeight(t, out.arc > 0 ? out.arc : THROW_ARC_HEIGHT);
  out.done = ageMs >= THROW_DELAY_MS + flight;
  return out;
}

// Mud Trap: how big a puddle is `ageMs` after it formed, as a share of its
// full size: it spreads out from MUD_FORM_FROM with a small overshoot over
// MUD_FORM_MS and is 1 from then on (and for any age that is not a number, so
// a puddle nobody saw form is at its full size).
export function mudSpread(ageMs) {
  if (!(ageMs < MUD_FORM_MS)) return 1;
  if (ageMs <= 0) return MUD_FORM_FROM;
  const u = ageMs / MUD_FORM_MS - 1;
  const eased = 1 + (MUD_FORM_BACK + 1) * u * u * u + MUD_FORM_BACK * u * u;
  return MUD_FORM_FROM + (1 - MUD_FORM_FROM) * eased;
}
const MUD_FORM_BACK = 1.2; // how far the spreading puddle swells past its size before it settles

// Mud Trap: how far a seed planted in mud has sunk `ageMs` after it was
// planted, 0 (at its plot) to 1 (all the way, dim): it lands for
// SINK_DELAY_MS, then sinks for SINK_MS. 1 for any age past that or not a
// number, so a seed that was sunk when the page loaded is fully sunk.
export function sinkAmount(ageMs) {
  if (!(ageMs < SINK_DELAY_MS + SINK_MS)) return 1;
  return smoothstep((ageMs - SINK_DELAY_MS) / SINK_MS);
}

// Mud Trap: how far below its plot a seed that has just surfaced still is
// `ageMs` after it surfaced, as a share of its sunk depth: 1 when it starts, it
// pops up to SURFACE_OVERSHOOT above its plot (a negative depth) at
// SURFACE_POP_AT of SURFACE_MS, and settles on its plot (0) at the end. 0 for
// any later age or one that is not a number.
export function surfaceDepth(ageMs) {
  if (!(ageMs < SURFACE_MS)) return 0;
  if (ageMs <= 0) return 1;
  const p = ageMs / SURFACE_MS;
  let rise;
  if (p < SURFACE_POP_AT) {
    const u = 1 - p / SURFACE_POP_AT;
    rise = (1 + SURFACE_OVERSHOOT) * (1 - u * u * u);
  } else {
    rise = 1 + SURFACE_OVERSHOOT * (1 - smoothstep((p - SURFACE_POP_AT) / (1 - SURFACE_POP_AT)));
  }
  return 1 - rise;
}

// Mud Trap: how solid the dried, cracked crust of a puddle still is `ageMs`
// after it dried (1 to 0 over DRY_MS), the opacity of its decal.
export function dryAmount(ageMs) {
  if (!(ageMs < DRY_MS)) return 0;
  if (ageMs <= 0) return 1;
  return 1 - smoothstep(ageMs / DRY_MS);
}

// Petrification: the wrap (earth energy winds round the plant and its colour
// drains to grey, flickering between its colours and grey first), the
// shatter (the grey plant bursts apart) and the rock popping in squashed and
// settling. petrifyMs is the whole length: the time the plot's real rock stays
// hidden behind the effect.
export const PETRIFY_STAGE_WRAP = 0;
export const PETRIFY_STAGE_SHATTER = 1;
export const PETRIFY_STAGE_ROCK = 2;

export function petrifyMs() {
  return PETRIFY_WRAP_MS + PETRIFY_SHATTER_MS + PETRIFY_SETTLE_MS;
}

// True while the wrapped plant shows as stone grey, `ageMs` into the wrap:
// colours until PETRIFY_FLICKER_FROM of the wrap, then PETRIFY_FLICKER_STEPS
// swaps to grey and back, grey for good from PETRIFY_GREY_FROM.
export function petrifyGrey(ageMs) {
  const p = ageMs / PETRIFY_WRAP_MS;
  if (!(p >= PETRIFY_FLICKER_FROM)) return false;
  if (p >= PETRIFY_GREY_FROM) return true;
  const phase = Math.floor(((p - PETRIFY_FLICKER_FROM) / (PETRIFY_GREY_FROM - PETRIFY_FLICKER_FROM)) * PETRIFY_FLICKER_STEPS * 2);
  return phase % 2 === 1;
}

// A Petrification pose.ageMs in: pose.stage (PETRIFY_STAGE_*), pose.grey (1
// while the grey plant is the one drawn, in the wrap and the shatter), and
// pose.scaleX and pose.scaleY of whatever is drawn (the plant trembles as the
// energy wraps it, bursts wide and flat as it shatters, the rock pops in
// squashed by PETRIFY_SQUASH and settles to 1), pose.done at the end.
export function petrifyPose(out) {
  const age = out.ageMs;
  const rockAt = PETRIFY_WRAP_MS + PETRIFY_SHATTER_MS;
  out.done = age >= rockAt + PETRIFY_SETTLE_MS;
  if (age < PETRIFY_WRAP_MS) {
    out.stage = PETRIFY_STAGE_WRAP;
    out.grey = petrifyGrey(age) ? 1 : 0;
    out.scaleX = 1 + 0.04 * Math.sin(age * 0.06) * clamp01(age / PETRIFY_WRAP_MS);
    out.scaleY = 1;
  } else if (age < rockAt) {
    const t = (age - PETRIFY_WRAP_MS) / PETRIFY_SHATTER_MS;
    out.stage = PETRIFY_STAGE_SHATTER;
    out.grey = 1;
    out.scaleX = 1 + 0.35 * t;
    out.scaleY = 1 - 0.9 * t * t;
  } else {
    const settle = clamp01((age - rockAt) / PETRIFY_SETTLE_MS);
    const squash = PETRIFY_SQUASH * (1 - settle) * (1 - settle);
    out.stage = PETRIFY_STAGE_ROCK;
    out.grey = 0;
    out.scaleX = 1 + squash;
    out.scaleY = 1 - squash;
  }
  return out;
}

// Venom: how long the cast plays for the target plant: the sap drops fall for
// VENOM_DROP_MS, then it droops, stays drooped and perks up again.
export function venomWiltMs() {
  return VENOM_DROP_MS + VENOM_WILT_IN_MS + VENOM_WILT_HOLD_MS + VENOM_WILT_OUT_MS;
}

// Venom: how drooped the target plant is `ageMs` after the cast, 0 (upright)
// to 1 (most): upright while the sap falls, it droops for VENOM_WILT_IN_MS,
// holds, and perks up over VENOM_WILT_OUT_MS. 0 for any age that is not a
// number or is past the end, so a plant nobody saw poisoned stands upright.
// The plant stays on the board the whole time.
export function venomWilt(ageMs) {
  const t = ageMs - VENOM_DROP_MS;
  if (!(t > 0)) return 0;
  if (t < VENOM_WILT_IN_MS) return smoothstep(t / VENOM_WILT_IN_MS);
  const held = t - VENOM_WILT_IN_MS;
  if (held < VENOM_WILT_HOLD_MS) return 1;
  const out = (held - VENOM_WILT_HOLD_MS) / VENOM_WILT_OUT_MS;
  return out < 1 ? 1 - smoothstep(out) : 0;
}

// Venom: how withered the plots of a new zone are `ageMs` after the cast (0 to
// 1, the opacity share of the poison decals): bare soil while the sap falls,
// then they turn over POISON_FORM_MS. 1 for any age that is not a number or
// is past it, so a zone the page loaded with is simply there.
export function poisonFormAmount(ageMs) {
  if (!(ageMs < VENOM_DROP_MS + POISON_FORM_MS)) return 1;
  if (ageMs <= VENOM_DROP_MS) return 0;
  return smoothstep((ageMs - VENOM_DROP_MS) / POISON_FORM_MS);
}

// Venom: how withered an ended zone still is `ageMs` after it ended: it thins
// away over POISON_FADE_MS. 0 once it is gone.
export function poisonFadeAmount(ageMs) {
  return ageMs >= 0 ? 1 - smoothstep(ageMs / POISON_FADE_MS) : 0;
}

// How thick a cloud is `ageMs` after it was placed (0 to 1): it thickens
// from nothing over CLOUD_FORM_MS.
export function cloudFormAmount(ageMs) {
  return ageMs >= 0 ? smoothstep(ageMs / CLOUD_FORM_MS) : 1;
}

// How thick an ended cloud still is `ageMs` after it ended: it thins away
// over CLOUD_FADE_MS. 0 once it is gone.
export function cloudFadeAmount(ageMs) {
  return ageMs >= 0 ? 1 - smoothstep(ageMs / CLOUD_FADE_MS) : 0;
}

// The Sky Watch outlines breathe: the share of their full opacity at
// `time` (ms), between SKY_WATCH_PULSE_LOW and 1, once per
// SKY_WATCH_PULSE_MS.
export function skyWatchPulse(time) {
  const wave = 0.5 + 0.5 * Math.cos((time / SKY_WATCH_PULSE_MS) * Math.PI * 2);
  return SKY_WATCH_PULSE_LOW + (1 - SKY_WATCH_PULSE_LOW) * wave;
}

// The lightning of the dense cloud the other seat sees: a look only. Time is
// cut into windows of CLOUD_LIGHTNING_MS; a window flashes with chance
// CLOUD_LIGHTNING_CHANCE, once, at a moment in it, as two quick pulses with a
// gap between. Whether, when and where in the cloud (a share, `pick`) all come
// from a hash of the window number and a seed (config CLOUD_LIGHTNING_SEED
// plus the cloud's cell), so the same time always gives the same flash. It is
// never part of the game state or of any message, and nothing here allocates.
const LIGHTNING_FLASH_MS = CLOUD_LIGHTNING_PULSE_MS * 2 + CLOUD_LIGHTNING_GAP_MS;

// A number in [0, 1) from two integers (an integer hash).
function hash01(a, b) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// When the flash of window `windowIndex` starts (ms), or NaN when it has none.
export function lightningStartMs(windowIndex, seed) {
  if (!(hash01(seed, windowIndex * 3) < CLOUD_LIGHTNING_CHANCE)) return NaN;
  return windowIndex * CLOUD_LIGHTNING_MS + hash01(seed, windowIndex * 3 + 1) * (CLOUD_LIGHTNING_MS - LIGHTNING_FLASH_MS);
}

// The share (0 to 1) of the cloud's cells at which the flash of window
// `windowIndex` strikes.
export function lightningPick(windowIndex, seed) {
  return hash01(seed, windowIndex * 3 + 2);
}

// How bright the flash is `timeMs` into the cloud's life of windows, 0 (none)
// to 1: a pulse that dies away, a gap, then a second softer pulse.
export function lightningAmount(timeMs, seed) {
  const start = lightningStartMs(Math.floor(timeMs / CLOUD_LIGHTNING_MS), seed);
  const local = timeMs - start; // NaN without a flash: every test below is false
  if (local >= 0 && local < CLOUD_LIGHTNING_PULSE_MS) return 1 - local / CLOUD_LIGHTNING_PULSE_MS;
  const second = local - CLOUD_LIGHTNING_PULSE_MS - CLOUD_LIGHTNING_GAP_MS;
  if (second >= 0 && second < CLOUD_LIGHTNING_PULSE_MS) return 0.7 * (1 - second / CLOUD_LIGHTNING_PULSE_MS);
  return 0;
}

// The share of the cells the flash of the window `timeMs` falls in strikes.
export function lightningPickAt(timeMs, seed) {
  return lightningPick(Math.floor(timeMs / CLOUD_LIGHTNING_MS), seed);
}

// Every flash from `fromMs` up to `toMs`, oldest first, as a frozen list of
// { startMs, endMs, pick } (for tests and tools: the drawing reads
// lightningAmount).
export function lightningSchedule(seed, fromMs, toMs) {
  const flashes = [];
  for (let w = Math.floor(fromMs / CLOUD_LIGHTNING_MS); w * CLOUD_LIGHTNING_MS < toMs; w++) {
    const startMs = lightningStartMs(w, seed);
    if (startMs >= fromMs && startMs < toMs) flashes.push(Object.freeze({ startMs, endMs: startMs + LIGHTNING_FLASH_MS, pick: lightningPick(w, seed) }));
  }
  return Object.freeze(flashes);
}

// A converting plant pose.ageMs in: the old plant wilts back to Sprout
// (reverse growth, convertWiltMs), then a small spark runs through the soil
// for CONVERT_SPARK_MS, after which the other team's plant regrows from
// Land (the piece layer grows it, see regrowCell). pose.frame (the old
// plant's stage), pose.spark (-1 before the spark, then 0 to 1 along its
// path), pose.done.
export function convertPose(out, stageStartMs) {
  const { ageMs } = out;
  reverseGrowthInto(out, stageStartMs, STAGE_REST, STAGE_SPROUT);
  const wiltMs = convertWiltMs(stageStartMs);
  out.spark = ageMs < wiltMs ? -1 : clamp01((ageMs - wiltMs) / CONVERT_SPARK_MS);
  out.done = ageMs >= wiltMs + CONVERT_SPARK_MS;
  out.ageMs = ageMs;
  return out;
}

// Where the conversion spark is at pose.spark (0 to 1) on the plot centred
// on (wx, wz): it enters at the plot's upper left (where the wind comes
// from), wriggles through the soil and ends under the plant at the centre.
// Writes pose.x and pose.z.
export const SPARK_REACH = 0.42; // world units from the plot centre where the spark starts
export function sparkPathInto(out, wx, wz) {
  const t = clamp01(out.spark);
  const along = SPARK_REACH * (1 - t);
  const wriggle = 0.08 * Math.sin(3 * Math.PI * t) * (1 - t);
  out.x = wx - along + wriggle;
  out.z = wz - along - wriggle;
  return out;
}

// Camera shake shake.ageMs into a shake of shake.strength world units: a
// quick wobble that dies out over SHAKE3D_MS. Writes shake.x and shake.y,
// how far to move the camera along its own right and up directions.
export function shakeOffset3d(out) {
  const { ageMs, strength } = out;
  if (!(ageMs >= 0) || ageMs >= SHAKE3D_MS || !(strength > 0)) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const fade = 1 - ageMs / SHAKE3D_MS;
  const amplitude = strength * fade * fade;
  out.x = amplitude * Math.sin(ageMs * 0.11);
  out.y = amplitude * Math.cos(ageMs * 0.15);
  return out;
}

// How strong a shake that started `ageMs` ago still is, to decide whether a
// new shake should replace it.
export function shakeLeft(ageMs, strength) {
  if (!(ageMs >= 0) || ageMs >= SHAKE3D_MS) return 0;
  const fade = 1 - ageMs / SHAKE3D_MS;
  return strength * fade * fade;
}

// World units that one screen pixel covers at `distance` from a camera with
// a vertical field of view of fovDeg drawing heightPx pixels tall.
export function worldUnitsPerPixel(distance, fovDeg, heightPx) {
  return (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx);
}

// Rounds `value` to whole steps, so a camera offset moves the board by
// whole screen pixels and sprite pixels never shimmer.
export function snapToStep(value, step) {
  if (!(step > 0)) return value;
  return Math.round(value / step) * step;
}
