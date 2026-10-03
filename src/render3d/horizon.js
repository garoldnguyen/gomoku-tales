// The flat meadow's far edge (the horizon), the back row of trees and the
// drawn ground rectangle, all worked out from the fixed camera of
// framing.js (docs/art-direction-v3.md sections 6 and 7, "Framing
// numbers"). The tests project points through the real camera to check
// them. Pure: no Three.js imports, so it runs under node --test.
//
// A camera here is either the plain { position, target, fovDeg } of
// camera.js or a Three.js PerspectiveCamera (position, quaternion, fov):
// both describe the same fixed camera.

import { cameraRay, gameCamera, projectToNdc } from './camera.js';
import { ASPECTS, FAR_EDGE_NDC_Y, GAME_ASPECT } from './framing.js';

const WIDEST_ASPECT = ASPECTS['21:9'];

const DEG = Math.PI / 180;

// The plain { position, target, fovDeg, aspect } of `camera` (either kind)
// at `aspect`. A Three.js camera has no target, so a point straight ahead
// along its view direction (-z turned by its quaternion) stands in.
export function cameraSpec(camera, aspect) {
  if (camera.target) return { position: camera.position, target: camera.target, fovDeg: camera.fovDeg, aspect };
  const { x, y, z, w } = camera.quaternion;
  // (0, 0, -1) turned by the unit quaternion (x, y, z, w).
  const forward = { x: -2 * (x * z + w * y), y: -2 * (y * z - w * x), z: -(1 - 2 * (x * x + y * y)) };
  const p = camera.position;
  return {
    position: { x: p.x, y: p.y, z: p.z },
    target: { x: p.x + forward.x, y: p.y + forward.y, z: p.z + forward.z },
    fovDeg: camera.fov,
    aspect,
  };
}

// Where the ray through NDC (x, y) meets the ground plane y = 0, as
// { x, z }, or null when it never does.
export function groundUnderNdc(spec, ndcX, ndcY) {
  const { origin, direction } = cameraRay(ndcX, ndcY, spec);
  if (!(direction.y < 0)) return null;
  const s = -origin.y / direction.y;
  return { x: origin.x + direction.x * s, z: origin.z + direction.z * s };
}

// The z of the far edge of the ground: the ray through the screen point
// 21 percent down from the top (NDC y = FAR_EDGE_NDC_Y) meets the plane
// y = 0 there. The ground ends at that z. The camera's vertical field of
// view is fixed, so every aspect gets the same far edge.
export function farEdgeZ(camera, aspect = GAME_ASPECT) {
  return groundUnderNdc(cameraSpec(camera, aspect), 0, FAR_EDGE_NDC_Y).z;
}

// Screen percentages of world point `p` { x, y, z }: { x: from the left,
// y: from the top }, or null behind the camera.
export function screenPercent(p, camera, aspect = GAME_ASPECT) {
  const ndc = projectToNdc(p, cameraSpec(camera, aspect));
  return ndc && { x: ((ndc.x + 1) / 2) * 100, y: ((1 - ndc.y) / 2) * 100 };
}

// The x where the left (side -1) or right (+1) screen edge meets the ground
// line at depth `z`, for `aspect`.
export function screenEdgeX(camera, aspect, z, side) {
  const spec = cameraSpec(camera, aspect);
  // Bisect on NDC y for the screen row that shows ground line z.
  let lo = -1;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const g = groundUnderNdc(spec, 0, mid);
    if (g && g.z > z) lo = mid;
    else hi = mid;
  }
  return groundUnderNdc(spec, side, (lo + hi) / 2).x;
}

// --- The game's own framing, from the real camera at 16:9. ---

const CAMERA = gameCamera(GAME_ASPECT);

// The far edge, the horizon.
export const FAR_EDGE_Z = farEdgeZ(CAMERA);
// The ground line at the bottom of the screen.
const BOTTOM_Z = groundUnderNdc(CAMERA, 0, -1).z;

// Low: the far edge is drawn as a gentle wavy line. farEdgeWave(x) is how
// far (world z) the edge lies in front of (+) or behind (-) FAR_EDGE_Z at
// x; FAR_EDGE_WAVE_Z keeps it well under 1 percent of the screen tall.
export const FAR_EDGE_WAVE_Z = 0.12;
export function farEdgeWave(x) {
  return FAR_EDGE_WAVE_Z * (0.6 * Math.sin(x * 0.37 + 0.8) + 0.4 * Math.sin(x * 0.91 + 2.3));
}

// The back row of trees stands on the ground just in front of the far edge,
// its trunk bases between TREE_ROW_Z[0] and TREE_ROW_Z[1] (about 22 to 23
// percent down at 16:9), along a width that covers 21:9 plus
// TREE_ROW_OVERHANG on each side.
export const TREE_ROW_Z = Object.freeze([-10.65, -10.4]);
const TREE_ROW_OVERHANG = 2;
export const TREE_ROW_HALF_WIDTH = screenEdgeX(CAMERA, WIDEST_ASPECT, FAR_EDGE_Z, 1) + TREE_ROW_OVERHANG;
export const TREE_ROW_SPACING = 3; // average between back-row trunks

// Side trees stay in the back third of the visible ground depth.
export const SIDE_TREE_MAX_Z = FAR_EDGE_Z + (BOTTOM_Z - FAR_EDGE_Z) / 3;

// The drawn ground: one flat rectangle at y = 0 from the far edge forward
// that covers every pixel below the far edge at every supported window
// shape, 9:21 to 32:9 (docs/art-direction-v3-1.md section 3.3). The
// ground bounds come from here only: GROUND_HALF_WIDTH to each side (32:9
// needs about 39 at the far edge) and GROUND_NEAR_Z toward the camera (the
// widened 9:21 view needs about z 22 at the bottom of the window).
export const GROUND_HALF_WIDTH = 44;
export const GROUND_NEAR_Z = 24;
export const GROUND_RECT = Object.freeze({
  minX: -GROUND_HALF_WIDTH,
  maxX: GROUND_HALF_WIDTH,
  minZ: FAR_EDGE_Z,
  maxZ: GROUND_NEAR_Z,
});

// Where the meadow is planted: the ground the camera sees, from the far
// edge to just past the bottom of the screen, as wide as the back row of
// trees, so flowers, tufts and bushes cover all of the visible ground.
export const MEADOW_PLANT_BOUNDS = Object.freeze({
  minX: -TREE_ROW_HALF_WIDTH,
  maxX: TREE_ROW_HALF_WIDTH,
  minZ: FAR_EDGE_Z,
  maxZ: BOTTOM_Z + 0.5,
});

// The angle below the horizon of the screen row `percentY` percent down
// from the top, for the game camera looking down `pitchDeg` with a
// vertical field of view `fovDeg`.
const CAMERA_PITCH = Math.atan2(CAMERA.position.y - CAMERA.target.y, CAMERA.position.z - CAMERA.target.z) / DEG;
export function depressionAtScreenY(percentY, pitchDeg = CAMERA_PITCH, fovDeg = CAMERA.fovDeg) {
  const ndcY = 1 - (2 * percentY) / 100;
  return pitchDeg - Math.atan(ndcY * Math.tan((fovDeg * DEG) / 2)) / DEG;
}
