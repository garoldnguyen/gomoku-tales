// The Venom visuals that live on the field (docs/free-action-design.md
// sections 5 and 8): the target plant droops a little after the sap has
// landed and perks up again (venomWilt), the withered soil of the zone turns in
// (poisonFormAmount), fog hugs the ground of the poisoned plots and toxic
// bubbles pop on them while the zone lasts, and when it ends the soil and fog
// thin away over the plots it showed (poisonFadeAmount). The zone itself is
// drawn from the viewer's state every frame (poison-view.js, world-renderer.js);
// the events only start the timings here, so a zone the page loaded with is
// simply there. The particle bursts of the cast and the end are plans
// (skill-plans.js venomPlan, poisonEndPlan) that effects3d.js plays. Nothing
// here is drawn on a plot the viewer's state covers: the plots come from
// poisonPlotsInto, which leaves them out, and cover() forgets a plot that
// became covered. The per-frame work allocates nothing.

import { BOARD_SIZE, POISON_BUBBLE_RATE, POISON_FOG_RATE, PX_WORLD } from '../config.js';
import { poisonFadeAmount, poisonFormAmount, venomWilt } from './effect-plans.js';
import { emit, SHAPE_SQUARE } from './particle-pool.js';
import { cellToWorldInto } from './picking.js';
import { createPoisonPlots, poisonPlotsInto } from './poison-view.js';
import { STEP_LOOKS } from './skill-plans.js';
import { WIND_GROUND } from './wind.js';

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
const FOG = STEP_LOOKS.poisonFog;
const BUBBLE = STEP_LOOKS.toxicBubble;

// `fx` is the effects' shared context (effects3d.js createEffects3d): the
// world, the particle pool and its spawn parameters, the random numbers and
// this frame's numbers.
export function createPoisonEffects({ pool, sp, random, u, frame }) {
  const plots = createPoisonPlots(); // the viewer's zone plots this frame (setState)
  const wiltStart = new Float64Array(CELL_COUNT).fill(-Infinity); // per plot index: when its plant was poisoned
  const fogCarry = new Float64Array(CELL_COUNT); // each plot's emission remainders
  const bubbleCarry = new Float64Array(CELL_COUNT);
  const emitter = { carry: 0.5 };
  const at = { x: 0.5, z: 0.5 };
  let formStart = -Infinity; // when the newest zone was cast
  let endStart = -Infinity; // when the last zone ended
  // The plots the zone showed on its last frame, kept for the thinning away.
  const lastX = new Int16Array(CELL_COUNT);
  const lastY = new Int16Array(CELL_COUNT);
  const lastEmpty = new Uint8Array(CELL_COUNT);
  const lastCentre = new Uint8Array(CELL_COUNT);
  let lastCount = 0;
  // The plots that thin away now (copied from last when the zone ends).
  const fadeX = new Int16Array(CELL_COUNT);
  const fadeY = new Int16Array(CELL_COUNT);
  const fadeEmpty = new Uint8Array(CELL_COUNT); // 1: the withered soil lay on it
  const fadeCentre = new Uint8Array(CELL_COUNT); // 1: the target plot (no fog of its own)
  let fadeCount = 0;

  // One fog wisp lifting off the plot (x, y) and drifting with the wind.
  function wisp(x, y) {
    cellToWorldInto(x, y, at);
    random.fill(u);
    sp.x = at.x - 0.35 + u[0] * 0.7;
    sp.y = 0.04 + u[1] * 0.08;
    sp.z = at.z - 0.35 + u[2] * 0.7;
    sp.vx = WIND_GROUND.x * 0.12;
    sp.vy = 0.05 + u[3] * 0.06;
    sp.vz = WIND_GROUND.z * 0.12;
    sp.gravity = 0;
    sp.drag = 0.8;
    sp.life = 1.3 + u[4] * 0.7;
    sp.size = FOG.sizePx * PX_WORLD;
    sp.grow = FOG.growPx * PX_WORLD;
    sp.color = FOG.colours[Math.floor(u[5] * FOG.colours.length)];
    sp.alpha = FOG.alpha;
    sp.shape = SHAPE_SQUARE;
    pool.spawnFall(sp);
  }

  // One toxic bubble popping up on the plot (x, y).
  function bubble(x, y) {
    cellToWorldInto(x, y, at);
    random.fill(u);
    sp.x = at.x - 0.3 + u[0] * 0.6;
    sp.y = 0.04;
    sp.z = at.z - 0.3 + u[1] * 0.6;
    sp.vx = 0;
    sp.vy = 0.22 + u[2] * 0.2;
    sp.vz = 0;
    sp.gravity = 0;
    sp.drag = 1.4;
    sp.life = 0.5 + u[3] * 0.4;
    sp.size = (1 + u[4] * 1.5) * PX_WORLD;
    sp.grow = BUBBLE.growPx * PX_WORLD;
    sp.color = BUBBLE.colours[Math.floor(u[5] * BUBBLE.colours.length)];
    sp.alpha = BUBBLE.alpha;
    sp.shape = SHAPE_SQUARE;
    pool.spawnFall(sp);
  }

  // The fog and bubbles of the plot at list index k this frame.
  function emitOn(k) {
    const i = plots.y[k] * BOARD_SIZE + plots.x[k];
    emitter.carry = fogCarry[i];
    const wisps = emit(emitter, POISON_FOG_RATE * frame.scale, frame.dtS);
    fogCarry[i] = emitter.carry;
    for (let n = 0; n < wisps; n++) wisp(plots.x[k], plots.y[k]);
    emitter.carry = bubbleCarry[i];
    const bubbles = emit(emitter, POISON_BUBBLE_RATE * frame.scale, frame.dtS);
    bubbleCarry[i] = emitter.carry;
    for (let n = 0; n < bubbles; n++) bubble(plots.x[k], plots.y[k]);
  }

  return {
    // The viewer's state this frame: its zone plots (poisonPlotsInto) are the
    // ones that show fog and bubbles. When a zone that was showing is gone,
    // nothing here decides it ended: the poisonEnded event does (end()).
    setState(state) {
      poisonPlotsInto(state, plots);
      lastCount = 0;
      for (let k = 0; k < plots.count; k++) {
        lastX[lastCount] = plots.x[k];
        lastY[lastCount] = plots.y[k];
        lastEmpty[lastCount] = plots.empty[k];
        lastCentre[lastCount] = plots.centre[k];
        lastCount++;
      }
    },

    // A zone is cast at `time`: its soil turns in once the sap has landed.
    form() {
      formStart = frame.time;
      endStart = -Infinity;
      fadeCount = 0;
    },

    // The target plant on plot index i was poisoned: it droops a little.
    wiltPlot(i) {
      wiltStart[i] = frame.time;
    },

    // The zone ended: the plots it showed on the last frame thin away. Returns
    // how many plots that is (the plan for the fog wisps names the same ones).
    end() {
      endStart = frame.time;
      fadeCount = lastCount;
      for (let k = 0; k < lastCount; k++) {
        fadeX[k] = lastX[k];
        fadeY[k] = lastY[k];
        fadeEmpty[k] = lastEmpty[k];
        fadeCentre[k] = lastCentre[k];
      }
      return fadeCount;
    },

    // How withered the plots of the zone are at `time` (a share of the decal's
    // opacity): turning in after the cast, 1 otherwise.
    formAmount(time) {
      return poisonFormAmount(time - formStart);
    },

    // How much of an ended zone is left at `time`, 0 when there is none.
    fadeAmount(time) {
      return fadeCount > 0 ? poisonFadeAmount(time - endStart) : 0;
    },

    // The plots of the thinning zone: fadeX[k], fadeY[k] for k below fadeCount,
    // with fadeEmpty[k] (the soil lay on it) and fadeCentre[k] (the target plot).
    fadeX,
    fadeY,
    fadeEmpty,
    fadeCentre,
    get fadeCount() {
      return fadeCount;
    },

    // How drooped the plant on plot index i is at `time` (0 to 1).
    wilt(i, time) {
      return venomWilt(time - wiltStart[i]);
    },

    // Before the render: the fog and the bubbles of the plots that stay. Not
    // on the target plot (its plant has the sap), and none on Low (the
    // particle scale is 0 there).
    update() {
      if (!(frame.scale > 0)) return;
      for (let k = 0; k < plots.count; k++) {
        if (plots.centre[k] === 0) emitOn(k);
      }
    },

    // The plot (x, y) became covered for the viewer: its timings are forgotten
    // and it leaves the thinning list, so nothing of it shows again.
    cover(x, y) {
      const i = y * BOARD_SIZE + x;
      wiltStart[i] = -Infinity;
      for (let k = 0; k < fadeCount; k++) {
        if (fadeX[k] === x && fadeY[k] === y) {
          fadeCount--;
          fadeX[k] = fadeX[fadeCount];
          fadeY[k] = fadeY[fadeCount];
          fadeEmpty[k] = fadeEmpty[fadeCount];
          fadeCentre[k] = fadeCentre[fadeCount];
          break;
        }
      }
    },

    // A new game: every timing and plot is gone.
    reset() {
      wiltStart.fill(-Infinity);
      fogCarry.fill(0);
      bubbleCarry.fill(0);
      formStart = -Infinity;
      endStart = -Infinity;
      plots.count = 0;
      lastCount = 0;
      fadeCount = 0;
    },
  };
}
