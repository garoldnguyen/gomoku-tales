// Pure depth-of-field and depth-range math for the farmland scene
// (docs/art-direction-v3.md section 5, High only). The blur pass in
// post-processing.js reads the depth of the real scene render, so every
// sprite writes depth only where its own alpha test keeps a pixel, and soft
// quads (wisps, rays, petals, ghost trails) write none. No Three.js
// imports, so it runs under node --test.
//
// A pose is the plain { position, target } of camera.js (gameCamera):
// the camera looks from position toward target. A depth is a view depth:
// the distance in front of the camera along its view direction, as the
// depth buffer stores it.

import {
  BOARD_SIZE, CELL_SIZE, CLOUD_LAYERS, DOF_BLUR_PER_UNIT, DOF_MAX_BLUR, DOF_SHARP_MARGIN, SUN_RAY_DEPTH,
} from '../config.js';
import { cameraRay } from './camera.js';
import { FAR_EDGE_NDC_Y } from './framing.js';
import { groundUnderNdc, TREE_ROW_Z } from './horizon.js';
import { FAR_HILLS } from './meadow.js';

const FIELD_HALF = (BOARD_SIZE * CELL_SIZE) / 2;
export const FIELD_FRONT_Z = FIELD_HALF; // the field's edge nearest the camera
export const FIELD_BACK_Z = -FIELD_HALF;
export const CLIP_MARGIN = 0.1; // the near and far planes leave 10 percent around what shows

// View depth of world point (x, y, z) for `pose`. No allocations.
export function viewDepthAt(x, y, z, pose) {
  const { position: p, target: t } = pose;
  const fx = t.x - p.x;
  const fy = t.y - p.y;
  const fz = t.z - p.z;
  const length = Math.hypot(fx, fy, fz);
  return ((x - p.x) * fx + (y - p.y) * fy + (z - p.z) * fz) / length;
}

export function viewDepth(point, pose) {
  return viewDepthAt(point.x, point.y, point.z, pose);
}

// The depth of field focus: the distance from the camera to the board centre.
export function focusDistance(pose) {
  const p = pose.position;
  return Math.hypot(p.x, p.y, p.z);
}

// The sharp band { focus, near, far } of `pose`, written into `out`: every
// depth from DOF_SHARP_MARGIN in front of the field's front edge to
// DOF_SHARP_MARGIN behind its back edge, stretched to the back row of trees
// (which also covers the fence), on the ground plane. Ground points of one
// row share a depth, so this holds across the whole width of the field.
export function sharpBandInto(pose, out) {
  out.focus = focusDistance(pose);
  out.near = viewDepthAt(0, 0, FIELD_FRONT_Z + DOF_SHARP_MARGIN, pose);
  out.far = Math.max(viewDepthAt(0, 0, FIELD_BACK_Z - DOF_SHARP_MARGIN, pose), viewDepthAt(0, 0, TREE_ROW_Z[0], pose));
  return out;
}

export function sharpBand(pose) {
  return sharpBandInto(pose, { focus: 0, near: 0, far: 0 });
}

// Blur radius (a fraction of the screen height) at view depth `depth` for
// `pose`: exactly 0 inside the sharp band, then growing gently by
// DOF_BLUR_PER_UNIT per world unit outside it, never past DOF_MAX_BLUR.
// The blur shader in post-processing.js uses the same formula.
export function blurRadius(depth, pose, band = sharpBand(pose)) {
  const outside = depth < band.near ? band.near - depth : depth > band.far ? depth - band.far : 0;
  return Math.min(DOF_MAX_BLUR, outside * DOF_BLUR_PER_UNIT);
}

// A pose object for livePose to fill, made once.
export function createPose() {
  return { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
}

// The pose of a live Three.js camera (position and matrixWorld, so the
// screen shake and the aim are included) written into `out`. The camera
// looks down its local -z axis. No allocations.
export function livePoseInto(camera, out) {
  const p = camera.position;
  const m = camera.matrixWorld.elements;
  out.position.x = p.x;
  out.position.y = p.y;
  out.position.z = p.z;
  out.target.x = p.x - m[8];
  out.target.y = p.y - m[9];
  out.target.z = p.z - m[10];
  return out;
}

// Per-frame state of the blur pass: one pose and one band, reused.
export function createDofState() {
  return { pose: createPose(), band: { focus: 0, near: 0, far: 0 } };
}

// Writes the blur pass uniforms from the LIVE camera: its clip planes and
// the sharp band of its current pose. `uniforms` holds { value } objects
// named cameraNear, cameraFar, bandNear, bandFar, blurPerUnit, maxBlur and
// aspect. Values are written only when they change.
export function updateDofUniforms(uniforms, camera, state) {
  sharpBandInto(livePoseInto(camera, state.pose), state.band);
  set(uniforms.cameraNear, camera.near);
  set(uniforms.cameraFar, camera.far);
  set(uniforms.aspect, camera.aspect);
  set(uniforms.bandNear, state.band.near);
  set(uniforms.bandFar, state.band.far);
  set(uniforms.blurPerUnit, DOF_BLUR_PER_UNIT);
  set(uniforms.maxBlur, DOF_MAX_BLUR);
  return uniforms;
}

function set(uniform, value) {
  if (uniform.value !== value) uniform.value = value;
}

// The view depths of what the camera of `pose` ({ position, target, fovDeg,
// aspect }) can show: { nearest, farthest }. Nearest is the sun rays
// (SUN_RAY_DEPTH in front of the camera) or the ground at the bottom of the
// screen; farthest is the far cloud layer, the far edge of the ground or a
// far hill where it meets the far edge's screen row (anything of a hill
// lower on screen lies behind the meadow).
export function visibleDepths(pose) {
  const bottom = groundUnderNdc(pose, 0, -1);
  const edge = groundUnderNdc(pose, 0, FAR_EDGE_NDC_Y);
  const nearest = Math.min(SUN_RAY_DEPTH, viewDepthAt(bottom.x, 0, bottom.z, pose));
  let farthest = Math.max(CLOUD_LAYERS.far.depth, CLOUD_LAYERS.near.depth, viewDepthAt(edge.x, 0, edge.z, pose));
  const { origin, direction } = cameraRay(0, FAR_EDGE_NDC_Y, pose);
  for (const hill of FAR_HILLS) {
    const s = (hill.z - origin.z) / direction.z;
    farthest = Math.max(farthest, viewDepthAt(origin.x + direction.x * s, origin.y + direction.y * s, hill.z, pose));
  }
  return { nearest, farthest };
}

// The camera's near and far planes for `pose`: everything visibleDepths
// lists fits inside with CLIP_MARGIN to spare and no more, so the depth
// buffer keeps as much precision as it can.
export function clipPlanes(pose) {
  const { nearest, farthest } = visibleDepths(pose);
  return { near: nearest * (1 - CLIP_MARGIN), far: farthest * (1 + CLIP_MARGIN) };
}
