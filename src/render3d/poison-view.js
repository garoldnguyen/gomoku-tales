// What the board shows of a Venom zone for one viewer (docs/free-action-design.md
// section 8). Pure: no DOM or Three.js, so it runs under node --test.
//
// The zone (state.poison) is a public fact: both seats and spectators have it
// whole. What the viewer's own copy of the board may show of it is not:
// `state` is the state as the viewer may see it (maskForViewer in
// src/logic/cloud.js), so a plot under the other seat's cloud is listed in
// state.covered and is left out here. Nothing about a covered plot is ever
// drawn: no withered soil, no fog, no bubble, no forbidden border.
//
// The plots of the zone for the viewer, written into a reusable list
// (poisonPlotsInto) so the render loop makes nothing:
//   x[i], y[i]   the plot
//   empty[i]     1 when the viewer's board shows it empty (the withered soil
//                of poison-plot.png lies on those; a plot with a plant has its
//                plant standing in the fog)
//   centre[i]    1 for the plot of the target plant, which the sap falls on
//                (its plant stays; it has no fog of its own)

import { BOARD_SIZE } from '../config.js';
import { isCovered } from '../logic/cloud.js';
import { EMPTY } from '../logic/board.js';

export function createPoisonPlots(capacity = BOARD_SIZE * BOARD_SIZE) {
  return { x: new Int16Array(capacity), y: new Int16Array(capacity), empty: new Uint8Array(capacity), centre: new Uint8Array(capacity), count: 0 };
}

// The plots of `state.poison` the viewer may see, written into `out`.
// Returns `out`. A state without a zone gives none.
export function poisonPlotsInto(state, out) {
  out.count = 0;
  const zone = state?.poison;
  const cells = zone?.cells;
  if (!cells) return out;
  const board = state.board;
  for (let i = 0; i < cells.length && out.count < out.x.length; i++) {
    const { x, y } = cells[i];
    if (isCovered(state, x, y)) continue;
    const at = out.count++;
    out.x[at] = x;
    out.y[at] = y;
    out.empty[at] = board?.[y]?.[x] === EMPTY ? 1 : 0;
    out.centre[at] = x === zone.x && y === zone.y ? 1 : 0;
  }
  return out;
}

// True when (x, y) is an empty plot of the zone the viewer may see: the plot a
// pointer on it shows the red crossed-out border on (nobody may plant there).
export function isForbiddenPlot(plots, x, y) {
  for (let i = 0; i < plots.count; i++) {
    if (plots.empty[i] === 1 && plots.x[i] === x && plots.y[i] === y) return true;
  }
  return false;
}
