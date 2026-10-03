// Map 1, Windy Spring Breeze Hill (docs/art-direction-hd2d.md section C):
// everything around the board. The meadow (meadow-scene.js,
// docs/art-direction-v3.md section 6: the ground, far hills, trees,
// bushes, hay bales, grass tufts and flowers), the sky, clouds and wind
// petals (sky-scene.js, section 7) and light fog.
//
// The meadow is flat. The camera looks steeply down, so the ground ends at a
// far edge placed on purpose 21 percent down the view (horizon.js
// farEdgeZ), the horizon; the far hills, the trees and the sky stand
// behind it.

import * as THREE from 'three';
import { FOG_FAR, FOG_NEAR } from '../config.js';
import { createMeadow } from './meadow-scene.js';
import { createSky } from './sky-scene.js';

const COLORS = {
  haze: '#e2f1ec', // the fog colour, which the far hills fade toward
};

// Builds the scene around the board and returns { update(timeMs, dtMs),
// setFeatures(features) } for the moving parts and the quality switches
// (a row of src/render3d/quality.js). `camera` is the fixed camera and
// `cameraPosition` its position as a plain { x, y, z }. `sunRays` false
// hides the sun rays (the ?rays=off switch, see fxFeatures in quality.js).
export function buildBreezeHill(scene, cameraPosition, camera, { sunRays = true } = {}) {
  scene.fog = new THREE.Fog(COLORS.haze, FOG_NEAR, FOG_FAR);
  const meadow = createMeadow(scene, cameraPosition, { haze: COLORS.haze });
  const sky = createSky(scene, camera, cameraPosition, { sunRays });
  return {
    update(timeMs, dtMs) {
      meadow.update(timeMs, dtMs);
      sky.update(timeMs);
    },
    setFeatures(features) {
      meadow.setFeatures(features);
      sky.setFeatures(features);
    },
  };
}
