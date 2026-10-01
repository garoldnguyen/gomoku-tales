// What is under a pointer in the 3D game (docs/art-direction-hd2d.md
// section F). The 2D HUD canvas lies over the WebGL canvas and both fill
// the same 16:9 stage, so a point in HUD pixels (the 960x540 internal
// resolution) is also a point on the 3D view. Skill buttons on the HUD come
// first; otherwise a ray from the camera finds the board cell. Pure: no
// DOM or Three.js, so it runs under node --test.

import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from '../config.js';
import { HUD_3D } from '../render/layout.js';
import { skillHitTest } from '../ui/input.js';
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

// Returns hitTest(px, py) with the same results as the 2D hitTest in
// src/ui/input.js: { skill: { player, skillId } }, { cell: { x, y } } or null.
export function createWorldHitTest(cameraSetup, layout = HUD_3D) {
  return (px, py) => {
    const skill = skillHitTest(px, py, layout);
    if (skill) return skill;
    const cell = cellAtHudPoint(px, py, cameraSetup);
    return cell ? { cell } : null;
  };
}
