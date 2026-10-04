// Map 1, Windy Spring Breeze Hill (docs/art-direction-hd2d.md section C):
// everything around the board. The meadow (meadow-scene.js,
// docs/art-direction-v3.md section 6: the ground, trees, bushes, hay
// bales, grass tufts and flowers), the sky, clouds and wind petals
// (sky-scene.js, section 7), the two soft ridges (ridges-scene.js,
// docs/art-direction-v3-1.md section 5.6), the cloud shadows on High
// (cloud-shadows.js), the forest behind the far edge (forest-scene.js,
// docs/art-direction-v3-1.md section 6) and light fog in the haze colour (haze.js).
//
// The meadow is flat. The camera looks steeply down, so the ground ends at a
// far edge placed on purpose 21 percent down the view (horizon.js
// farEdgeZ), the horizon; the ridges and the sky stand behind it.

import * as THREE from 'three';
import { FOG_FAR, FOG_NEAR } from '../config.js';
import { createCloudShadows } from './cloud-shadows.js';
import { createForest } from './forest-scene.js';
import { HAZE_COLOR, hazeViewInto } from './haze.js';
import { createMeadow } from './meadow-scene.js';
import { createRidges } from './ridges-scene.js';
import { createSky } from './sky-scene.js';

// Builds the scene around the board and returns { update(timeMs, dtMs),
// setFeatures(features), setView(aspect, heightPx) } for the moving parts,
// the quality switches (a row of src/render3d/quality.js) and the window
// shape (the horizon moves on narrow windows). `camera` is the fixed camera and
// `cameraPosition` its position as a plain { x, y, z }. `sunRays` false
// hides the sun rays (the ?rays=off switch, see fxFeatures in quality.js).
export function buildBreezeHill(scene, cameraPosition, camera, { sunRays = true } = {}) {
  scene.fog = new THREE.Fog(HAZE_COLOR, FOG_NEAR, FOG_FAR);
  const meadow = createMeadow(scene, cameraPosition);
  const forest = createForest(scene, cameraPosition);
  const sky = createSky(scene, camera, cameraPosition, { sunRays });
  const ridges = createRidges(scene);
  const cloudShadows = createCloudShadows(scene);
  const view = { horizon: 0, zoom: 1 };
  return {
    update(timeMs, dtMs) {
      meadow.update(timeMs, dtMs);
      sky.update(timeMs);
      cloudShadows.update(timeMs);
    },
    setFeatures(features) {
      meadow.setFeatures(features);
      forest.setFeatures(features);
      sky.setFeatures(features);
      ridges.setFeatures(features);
      cloudShadows.setFeatures(features);
    },
    // The window is `aspect` wide and its drawing buffer `heightPx` tall.
    // Called on a resize, never per frame.
    setView(aspect, heightPx) {
      hazeViewInto(aspect, view);
      sky.setHorizon(view.horizon);
      ridges.setView(view.horizon, view.zoom, heightPx);
    },
  };
}
