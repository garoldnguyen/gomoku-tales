// Pure board picking math (docs/art-direction-hd2d.md section F): turn a
// pointer position into a ray and the ray into a board cell. No Three.js
// imports, so it runs under node --test.
//
// The board lies flat and centred on the world origin. Cell { x, y } uses
// the same x (column) and y (row) as src/logic: x grows towards +x and y
// grows towards +z, so row 0 is the far edge as seen from the camera.

import { BOARD_SIZE, CELL_SIZE } from '../config.js';

const BOARD = { boardSize: BOARD_SIZE, cellSize: CELL_SIZE };

// Normalized device coordinates (-1 to 1, y up) of a client-space pointer
// position inside an element's bounding rect.
export function pointerToNdc(clientX, clientY, rect) {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: 1 - ((clientY - rect.top) / rect.height) * 2,
  };
}

// Point where a ray meets the horizontal plane y = planeY, or null if the
// ray runs parallel to it or points away from it.
export function intersectHorizontalPlane(origin, direction, planeY = 0) {
  if (Math.abs(direction.y) < 1e-9) return null;
  const t = (planeY - origin.y) / direction.y;
  if (t < 0) return null;
  return { x: origin.x + direction.x * t, y: planeY, z: origin.z + direction.z * t };
}

// Board cell under a world point on the board plane, or null if off the board.
export function worldToCell(wx, wz, { boardSize, cellSize } = BOARD) {
  const half = boardSize / 2;
  const x = Math.floor(wx / cellSize + half);
  const y = Math.floor(wz / cellSize + half);
  if (x < 0 || y < 0 || x >= boardSize || y >= boardSize) return null;
  return { x, y };
}

// The index (y * boardSize + x) of the game board cell under a world point on
// the board plane, or -1 off the board. No allocation, for the render loop.
export function cellIndexAt(wx, wz) {
  const half = BOARD.boardSize / 2;
  const x = Math.floor(wx / BOARD.cellSize + half);
  const y = Math.floor(wz / BOARD.cellSize + half);
  if (x < 0 || y < 0 || x >= BOARD.boardSize || y >= BOARD.boardSize) return -1;
  return y * BOARD.boardSize + x;
}

// World x and z of a cell's centre.
export function cellToWorld(x, y, { boardSize, cellSize } = BOARD) {
  const offset = (boardSize - 1) / 2;
  return { x: (x - offset) * cellSize, z: (y - offset) * cellSize };
}

// cellToWorld on the game board, written into `out` { x, z } (no
// allocation, for the render loop). Returns `out`.
export function cellToWorldInto(x, y, out) {
  const offset = (BOARD.boardSize - 1) / 2;
  out.x = (x - offset) * BOARD.cellSize;
  out.z = (y - offset) * BOARD.cellSize;
  return out;
}

// The cell a ray hits on the board plane at height planeY, or null.
export function pickCell(origin, direction, { planeY = 0, boardSize = BOARD_SIZE, cellSize = CELL_SIZE } = {}) {
  const hit = intersectHorizontalPlane(origin, direction, planeY);
  if (!hit) return null;
  return worldToCell(hit.x, hit.z, { boardSize, cellSize });
}
