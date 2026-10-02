// What is under a pointer in the 3D game (docs/art-direction-hd2d.md
// section F). The 2D canvas lies over the WebGL canvas and both fill the
// same 16:9 stage, so a point in its pixels (the 960x540 internal
// resolution) is also a point on the 3D view, and a ray from the camera
// finds the board cell. The skill buttons are DOM buttons on the glass HUD
// (src/ui/hud.js) and get their own clicks. Pure: no DOM or Three.js, so it
// runs under node --test.

import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from '../config.js';
import { cameraRay } from './camera.js';
import { pickCell, pointerToNdc } from './picking.js';

const HUD_RECT = { left: 0, top: 0, width: INTERNAL_WIDTH, height: INTERNAL_HEIGHT };

// The board cell seen at an internal HUD point through the camera
// (cameraSetup: { position, target, fovDeg, aspect }), or null.
export function cellAtHudPoint(px, py, cameraSetup) {
  const ndc = pointerToNdc(px, py, HUD_RECT);
  const ray = cameraRay(ndc.x, ndc.y, cameraSetup);
  return pickCell(ray.origin, ray.direction);
}

// Returns hitTest(px, py) with the board results of the 2D hitTest in
// src/ui/input.js: { cell: { x, y } } or null.
export function createWorldHitTest(cameraSetup) {
  return (px, py) => {
    const cell = cellAtHudPoint(px, py, cameraSetup);
    return cell ? { cell } : null;
  };
}
