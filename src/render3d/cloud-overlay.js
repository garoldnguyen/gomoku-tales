// What the board shows of Cloud Eagle's two skills for one viewer
// (docs/design.md section 5). Pure: no DOM or Three.js, so it runs under
// node --test.
//
// The viewer is the seat whose eyes the board is drawn for: X or O (online
// this window's stone, on this computer the player to move), or null for a
// spectator, who sees the full state. `state` is the state as the viewer
// may see it (maskForViewer in src/logic/cloud.js): nothing here reads a
// cell the viewer may not see, so the overlay never tells a hidden stone.
//
// THE CLOUD: each cloud's cells (clipped to the board) with a look:
//   'seeThrough'  the owner and spectators: a translucent cloud with the
//                 plants and rocks inside visible
//   'cover'       the other seat: the area covered, nothing inside shown
// A cell under two clouds is listed once; cover wins.
//
// SKY WATCH: the cells of skyWatchCells for the side that plays Cloud
// Eagle, shown as soft yellow outlines to that side and to spectators, and
// to nobody else. Covered cells are left out (the viewer cannot see them).
// None once the round is over.

import { CLOUD_EAGLE } from '../logic/characters.js';
import { CHARACTER_LOOK } from './character-look.js';
import { createGrid, fillEllipse, fillRect, setPixel } from './pixel-art.js';
import { cloudCells, cloudsOf, isCovered, skyWatchCells } from '../logic/cloud.js';
import { isGameOver } from '../logic/game.js';
import { O, X } from '../logic/board.js';

export const SEE_THROUGH = 'seeThrough';
export const COVER = 'cover';

const NONE = Object.freeze([]);

// The side (X or O) Cloud Eagle plays in the state's sides, or null.
export function cloudEagleSide(state) {
  const sides = state?.characters;
  if (sides?.[X] === CLOUD_EAGLE) return X;
  if (sides?.[O] === CLOUD_EAGLE) return O;
  return null;
}

// The look of a cloud of `owner` for `viewer`.
export function cloudLook(owner, viewer) {
  return viewer === null || viewer === undefined || viewer === owner ? SEE_THROUGH : COVER;
}

// The cloud cells of the board for viewer: [{ x, y, look }], row by row,
// each cell once.
export function cloudOverlayCells(state, viewer) {
  const clouds = cloudsOf(state ?? {});
  if (clouds.length === 0) return NONE;
  const looks = new Map();
  for (const cloud of clouds) {
    const look = cloudLook(cloud.owner, viewer);
    for (const { x, y } of cloudCells(state.board, cloud)) {
      const key = y * state.board.length + x;
      if (looks.get(key) !== COVER) looks.set(key, look);
    }
  }
  const size = state.board.length;
  return [...looks.keys()].sort((a, b) => a - b).map((key) => ({ x: key % size, y: Math.floor(key / size), look: looks.get(key) }));
}

// The Sky Watch outline cells for viewer: [{ x, y }], row by row.
export function skyWatchOutlineCells(state, viewer) {
  const owner = cloudEagleSide(state);
  if (owner === null || isGameOver(state)) return NONE;
  if (viewer !== null && viewer !== undefined && viewer !== owner) return NONE;
  const cells = skyWatchCells(state, owner).filter(({ x, y }) => !isCovered(state, x, y));
  return cells.length === 0 ? NONE : cells;
}

// Both overlays of a game view, worked out again only when the drawn
// state or the viewer changes (the render loop calls it every frame).
// Returns { clouds, skyWatch } (the two lists above); the same object
// while nothing changed.
export function createCloudOverlay() {
  const result = { clouds: NONE, skyWatch: NONE, version: 0, state: null, viewer: undefined };
  const overlayFor = (state, viewer) => (state === result.state && viewer === result.viewer ? result : rebuildOverlay(result, state, viewer));
  return overlayFor;
}

// Only when the drawn state or its viewer changes.
function rebuildOverlay(result, state, viewer) {
  result.state = state;
  result.viewer = viewer;
  result.clouds = cloudOverlayCells(state, viewer);
  result.skyWatch = skyWatchOutlineCells(state, viewer);
  result.version++;
  return result;
}

// The viewer of a game view (see ui/local-game.js, online-game.js and
// spectator-game.js getView): view.viewer when the view names one (null
// for a spectator), else the player to move.
export function viewerOf(view) {
  return view.viewer !== undefined ? view.viewer : view.state?.currentPlayer ?? null;
}

// --- Tile art (pure pixel grids, sheetCanvas in sprites.js draws them) ---

export const OVERLAY_TILE_PX = 32; // one cell, like the v3 decals
export const CLOUD_TILE_COLOURS = Object.freeze({ base: '#eef3fb', light: '#ffffff', shade: '#dde6f2' });
export const SKY_WATCH_COLOUR = CHARACTER_LOOK[CLOUD_EAGLE].colour; // Cloud Eagle's pale yellow

// One cell of cloud: the whole tile filled, so the cells of a cloud join
// into one soft mass, with puffy light bumps and a few shade pixels. The
// owner sees it translucent, the other seat opaque (the material decides).
export function cloudTileGrid() {
  const n = OVERLAY_TILE_PX;
  const grid = createGrid(n, n);
  fillRect(grid, 0, 0, n, n, CLOUD_TILE_COLOURS.base);
  fillEllipse(grid, 9, 11, 7, 5, CLOUD_TILE_COLOURS.light);
  fillEllipse(grid, 22, 8, 6, 4, CLOUD_TILE_COLOURS.light);
  fillEllipse(grid, 17, 22, 8, 5, CLOUD_TILE_COLOURS.light);
  for (const [x, y] of [[4, 27], [5, 27], [27, 17], [28, 17], [13, 4], [26, 28], [27, 28]]) setPixel(grid, x, y, CLOUD_TILE_COLOURS.shade);
  return grid;
}

// One Sky Watch outline: a 2 pixel square ring with cut corners, 3 pixels
// in from the cell edge, in Cloud Eagle's pale yellow.
export function skyWatchOutlineGrid() {
  const n = OVERLAY_TILE_PX;
  const grid = createGrid(n, n);
  const a = 3;
  const b = n - 1 - a;
  for (let i = a + 2; i <= b - 2; i++) {
    for (const t of [0, 1]) {
      setPixel(grid, i, a + t, SKY_WATCH_COLOUR);
      setPixel(grid, i, b - t, SKY_WATCH_COLOUR);
      setPixel(grid, a + t, i, SKY_WATCH_COLOUR);
      setPixel(grid, b - t, i, SKY_WATCH_COLOUR);
    }
  }
  for (const [x, y] of [[a + 1, a + 1], [b - 1, a + 1], [a + 1, b - 1], [b - 1, b - 1]]) setPixel(grid, x, y, SKY_WATCH_COLOUR);
  return grid;
}

// Under each Sky Watch outline: the plot lit in Cloud Eagle's pale yellow,
// brightest in the middle (three nested squares), so the cell glows.
export const SKY_WATCH_GLOW = Object.freeze({ outer: '#fff2b8', mid: '#ffe98a', core: '#ffe066' });
export function skyWatchGlowGrid() {
  const n = OVERLAY_TILE_PX;
  const grid = createGrid(n, n);
  fillRect(grid, 2, 2, n - 4, n - 4, SKY_WATCH_GLOW.outer);
  fillRect(grid, 7, 7, n - 14, n - 14, SKY_WATCH_GLOW.mid);
  fillRect(grid, 11, 11, n - 22, n - 22, SKY_WATCH_GLOW.core);
  return grid;
}

// A small cloud puff that drifts to and fro above a Sky Watch plot: three
// soft bumps on a flat base, light on top, a little shade underneath.
export function skyWatchPuffGrid() {
  const n = OVERLAY_TILE_PX;
  const grid = createGrid(n, n);
  fillEllipse(grid, 16, 18, 11, 5, CLOUD_TILE_COLOURS.shade);
  fillEllipse(grid, 16, 17, 11, 4, CLOUD_TILE_COLOURS.base);
  fillEllipse(grid, 10, 15, 5, 4, CLOUD_TILE_COLOURS.base);
  fillEllipse(grid, 17, 12, 6, 5, CLOUD_TILE_COLOURS.light);
  fillEllipse(grid, 23, 15, 4, 3, CLOUD_TILE_COLOURS.light);
  return grid;
}
