// The Mud Trap visuals that live on a plot (docs/free-action-design.md
// sections 3 and 8): a new puddle spreads out under its plot (mudSpread), a
// seed planted in it sinks and goes dim (sinkAmount), and when it surfaces or
// the puddle dries the dried, cracked crust shows over the plot and fades
// (dryAmount) while the sprout pops up (surfaceDepth). Puddles that stay
// bubble now and then. The puddle itself and the sunk seed are drawn from the
// viewer's state (world-renderer.js, board-marks.js); the events only start
// the timings here, so a puddle or a seed the page loaded with is simply
// there. The burst particles of each event are a plan (skill-plans.js) that
// effects3d.js plays; this module keeps the per-plot timings, the crust
// decals and the bubbles. The per-frame work allocates nothing.

import { BOARD_SIZE, DRY_SLOTS, MUD_BUBBLE_RATE, PX_WORLD } from '../config.js';
import { dryAmount, mudSpread, sinkAmount, surfaceDepth } from './effect-plans.js';
import { dryMudTileGrid } from './mud-dry-art.js';
import { emit, SHAPE_SQUARE } from './particle-pool.js';
import { cellToWorldInto } from './picking.js';
import { sheetCanvas } from './sprites.js';
import { createCellDecal, decalMaterial, placeOnCell } from './world.js';

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
const NONE = Object.freeze([]);
const BUBBLE_COLOURS = Object.freeze([0xb08a58, 0x8a6338]);
const CRUST_ORDER = 1; // over the puddle decals (0), under the cloud and the marks

// `fx` is the effects' shared context (effects3d.js createEffects3d): the
// world, the particle pool and its spawn parameters, the random numbers and
// this frame's numbers.
export function createMudEffects({ world, pool, sp, random, u, frame }) {
  // Per plot index (y * BOARD_SIZE + x): when its puddle formed, when its seed
  // began to sink and when it surfaced (ms; -Infinity: never, so a puddle or a
  // seed that was there when the page loaded is simply full size or fully sunk).
  const formStart = new Float64Array(CELL_COUNT).fill(-Infinity);
  const sinkStart = new Float64Array(CELL_COUNT).fill(-Infinity);
  const surfaceStart = new Float64Array(CELL_COUNT).fill(-Infinity);
  const carry = new Float64Array(CELL_COUNT); // each puddle's bubble emission remainder
  const emitter = { carry: 0.5 };
  const at = { x: 0.5, z: 0.5 };
  let mud = NONE; // the viewer's puddles and sunk seeds this frame (setState)
  let sunk = NONE;

  // The crust decals: a fixed set, each with its own material for its opacity
  // (they share the tile's texture).
  const crustMaterial = decalMaterial(sheetCanvas([dryMudTileGrid()]));
  const crusts = [];
  for (let i = 0; i < DRY_SLOTS; i++) {
    const material = crustMaterial.clone();
    const mesh = createCellDecal(material);
    mesh.renderOrder = CRUST_ORDER;
    mesh.name = 'mud-crust';
    world.scene.add(mesh);
    crusts.push({ mesh, material, active: false, start: 0.5, cell: -1 });
  }

  // The crust of a puddle that has just dried on cell (x, y): in a free slot,
  // or the oldest one when all are showing.
  function showCrust(x, y) {
    let slot = crusts[0];
    for (let i = 0; i < crusts.length; i++) {
      if (!crusts[i].active) {
        slot = crusts[i];
        break;
      }
      if (crusts[i].start < slot.start) slot = crusts[i];
    }
    slot.active = true;
    slot.start = frame.time;
    slot.cell = y * BOARD_SIZE + x;
    slot.material.opacity = 1;
    slot.mesh.visible = true;
    placeOnCell(slot.mesh, x, y);
  }

  function stepCrusts() {
    for (let i = 0; i < crusts.length; i++) {
      const slot = crusts[i];
      if (!slot.active) continue;
      const amount = dryAmount(frame.time - slot.start);
      if (amount <= 0) {
        slot.active = false;
        slot.mesh.visible = false;
      } else {
        slot.material.opacity = amount;
      }
    }
  }

  // One bubble popping up on the puddle of cell (x, y).
  function popBubble(x, y) {
    cellToWorldInto(x, y, at);
    random.fill(u);
    sp.x = at.x - 0.3 + u[0] * 0.6;
    sp.y = 0.04;
    sp.z = at.z - 0.3 + u[1] * 0.6;
    sp.vx = 0;
    sp.vy = 0.25 + u[2] * 0.2;
    sp.vz = 0;
    sp.gravity = 0;
    sp.drag = 1.5;
    sp.life = 0.5 + u[3] * 0.4;
    sp.size = (1 + u[4] * 1.5) * PX_WORLD;
    sp.grow = 1.5 * PX_WORLD;
    sp.color = u[5] < 0.5 ? BUBBLE_COLOURS[0] : BUBBLE_COLOURS[1];
    sp.alpha = 0.9;
    sp.shape = SHAPE_SQUARE;
    pool.spawnFall(sp);
  }

  // The bubbles of one puddle (or the puddle a sunk seed stands in) this frame.
  function bubbleOn(cell) {
    const i = cell.y * BOARD_SIZE + cell.x;
    if (!(i >= 0 && i < CELL_COUNT)) return;
    emitter.carry = carry[i];
    const count = emit(emitter, MUD_BUBBLE_RATE * frame.scale, frame.dtS);
    carry[i] = emitter.carry;
    for (let k = 0; k < count; k++) popBubble(cell.x, cell.y);
  }

  return {
    // The puddles and sunk seeds of the drawn state ({ x, y } lists, the
    // viewer's own copy, so a covered plot is never in them); null for none.
    setState(puddles, seeds) {
      mud = puddles ?? NONE;
      sunk = seeds ?? NONE;
    },

    // A puddle forms on (x, y): it spreads out from its middle.
    form(x, y) {
      formStart[y * BOARD_SIZE + x] = frame.time;
    },

    // A seed planted on (x, y) sank into its puddle.
    sink(x, y) {
      sinkStart[y * BOARD_SIZE + x] = frame.time;
      surfaceStart[y * BOARD_SIZE + x] = -Infinity;
    },

    // The seed on (x, y) surfaced as its mud dried: it pops up out of the crust.
    surface(x, y) {
      surfaceStart[y * BOARD_SIZE + x] = frame.time;
      showCrust(x, y);
    },

    // The puddle on (x, y) dried by itself.
    dry(x, y) {
      showCrust(x, y);
    },

    // How big the puddle on (x, y) is at `time`, as a share of its full size.
    spread(x, y, time) {
      return mudSpread(time - formStart[y * BOARD_SIZE + x]);
    },

    // How far below its plot the plant on plot index i stands at `time`, as
    // a share of the sunk depth: sinking in while its seed is sunk, rising out
    // (and a little past its plot) after it surfaced, 0 otherwise.
    depth(i, isSunk, time) {
      return isSunk ? sinkAmount(time - sinkStart[i]) : surfaceDepth(time - surfaceStart[i]);
    },

    // Before the render: the crusts fade, the standing puddles bubble.
    update() {
      stepCrusts();
      if (!(frame.scale > 0)) return;
      for (let i = 0; i < mud.length; i++) bubbleOn(mud[i]);
      for (let i = 0; i < sunk.length; i++) bubbleOn(sunk[i]);
    },

    // The plot (x, y) became covered for the viewer: its crust is gone at
    // once and its timings are forgotten, so a puddle or a sunk seed that is
    // seen again is simply there, not spreading or sinking a second time.
    cover(x, y) {
      const i = y * BOARD_SIZE + x;
      formStart[i] = -Infinity;
      sinkStart[i] = -Infinity;
      surfaceStart[i] = -Infinity;
      for (let k = 0; k < crusts.length; k++) {
        if (crusts[k].active && crusts[k].cell === i) {
          crusts[k].active = false;
          crusts[k].mesh.visible = false;
        }
      }
    },

    // A new game: every timing and crust is gone.
    reset() {
      formStart.fill(-Infinity);
      sinkStart.fill(-Infinity);
      surfaceStart.fill(-Infinity);
      carry.fill(0);
      mud = NONE;
      sunk = NONE;
      for (const slot of crusts) {
        slot.active = false;
        slot.mesh.visible = false;
      }
    },
  };
}
