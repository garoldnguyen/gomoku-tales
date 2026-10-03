// What is under a pointer in the 3D game (docs/art-direction-hd2d.md
// section F, docs/art-direction-v3-1.md section 3.1). The WebGL canvas
// fills the whole window and takes the pointer itself: a point in its
// drawing buffer pixels is a point on the 3D view, and a ray from the
// camera of that view (the same aspect and field of view that is drawn)
// finds the board cell, at every window shape. The skill buttons are DOM
// buttons on the glass HUD (src/ui/hud.js) and get their own clicks. Pure:
// no DOM or Three.js, so it runs under node --test.

import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from '../config.js';
import { cameraRay } from './camera.js';
import { pickCell } from './picking.js';

// The old 16:9 stage of the 2D canvas (960x540 internal pixels).
const HUD_RECT = Object.freeze({ width: INTERNAL_WIDTH, height: INTERNAL_HEIGHT });

// The board cell seen at point (px, py) of a view `view.width` x
// `view.height` pixels (from its top left) through the camera
// (cameraSetup: { position, target, fovDeg, aspect }), or null.
export function cellAtViewPoint(px, py, view, cameraSetup) {
  const ray = cameraRay((px / view.width) * 2 - 1, 1 - (py / view.height) * 2, cameraSetup);
  return pickCell(ray.origin, ray.direction);
}

// The board cell seen at an internal point of the 16:9 960x540 view, or null.
export function cellAtHudPoint(px, py, cameraSetup) {
  return cellAtViewPoint(px, py, HUD_RECT, cameraSetup);
}

// Returns hitTest(px, py) with the board results of the 2D hitTest in
// src/ui/input.js: { cell: { x, y } } or null. `view` { width, height } is
// the view the points are in, read on every call, so a live object (the
// WebGL canvas, whose width and height are its drawing buffer) keeps
// picking right after a resize; cameraSetup is read live too.
export function createWorldHitTest(cameraSetup, view = HUD_RECT) {
  return (px, py) => {
    const cell = cellAtViewPoint(px, py, view, cameraSetup);
    return cell ? { cell } : null;
  };
}
