// Map 1, Windy Spring Breeze Hill (docs/art-direction-hd2d.md section C):
// everything around the board. The meadow (meadow-scene.js,
// docs/art-direction-v3.md section 6: the ground, far hills, trees,
// bushes, hay bales, grass tufts and flowers), a sky gradient, drifting
// clouds, light fog and faint drifting wind streaks.
//
// The camera looks steeply down, so the hill falls away behind the board
// and the sky shows only in a band at the top of the view, above the crest.

import * as THREE from 'three';
import {
  CLOUD_COUNT, CLOUD_PX_WORLD, CLOUD_SPEED, CLOUD_VARIANTS, FOG_FAR, FOG_NEAR,
  WIND3D_STREAK_COUNT, WIND3D_STREAK_SPEED,
} from '../config.js';
import { artFrame } from './art.js';
import { ART } from './art-assets.js';
import { heightAtDepression } from './camera.js';
import { createMeadow } from './meadow-scene.js';
import { seededRandom } from './seeded-random.js';
import { faceYaw } from './sprite-frames.js';
import { pixelTexture, uprightPlaneGeometry } from './sprites.js';
import { GROUND_Y, terrainHeight } from './terrain.js';

const COLORS = {
  skyTop: '#4f9fe4',
  skyMid: '#9fd3f3',
  haze: '#e2f1ec', // the bottom of the sky and the fog colour
};

const CLOUD_DEPRESSION_DEG = [38.0, 38.6, 39.3]; // cloud heights in the sky band
const CLOUD_RANGE_X = 70; // clouds wrap around between -70 and +70
const STREAK_LENGTH = 3;
const STREAK_THICKNESS = 0.06;
const STREAK_OPACITY = 0.35;

// Builds the scene around the board and returns { update(timeMs, dtMs),
// setFeatures(features) } for the moving parts and the quality switches
// (a row of src/render3d/quality.js). `cameraPosition` is the fixed
// camera's position.
export function buildBreezeHill(scene, cameraPosition) {
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(COLORS.haze, FOG_NEAR, FOG_FAR);
  const meadow = createMeadow(scene, cameraPosition, { haze: COLORS.haze });
  const clouds = createClouds(cameraPosition);
  scene.add(clouds.group);
  const wind = createWindStreaks(cameraPosition);
  scene.add(wind.group);
  let moving = true;
  return {
    update(timeMs, dtMs) {
      meadow.update(timeMs, dtMs);
      if (!moving) return;
      clouds.update(dtMs);
      wind.update(timeMs, dtMs);
    },
    setFeatures(features) {
      meadow.setFeatures(features);
      clouds.group.visible = features.sky !== 'gradient';
      wind.group.visible = features.wind;
      moving = features.backgroundMotion;
    },
  };
}

// Vertical sky gradient drawn behind everything in screen space.
function skyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 540;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, COLORS.skyTop);
  gradient.addColorStop(0.16, COLORS.skyMid);
  gradient.addColorStop(0.4, COLORS.haze);
  gradient.addColorStop(1, COLORS.haze);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return pixelTexture(canvas);
}

// White clouds drifting slowly across the sky band.
function createClouds(cameraPosition) {
  const group = new THREE.Group();
  const random = seededRandom(23);
  const clouds = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const shape = artFrame(ART.cloud, i % CLOUD_VARIANTS);
    const material = new THREE.MeshBasicMaterial({
      map: pixelTexture(shape),
      alphaTest: 0.5,
    });
    const mesh = new THREE.Mesh(uprightPlaneGeometry(shape.width, shape.height, CLOUD_PX_WORLD, 1), material);
    const z = -40 - random() * 30;
    const x = -CLOUD_RANGE_X + ((i + random() * 0.6) / CLOUD_COUNT) * CLOUD_RANGE_X * 2;
    const depression = CLOUD_DEPRESSION_DEG[i % CLOUD_DEPRESSION_DEG.length];
    mesh.position.set(x, heightAtDepression(cameraPosition, x, z, depression), z);
    group.add(mesh);
    clouds.push({ mesh, z, depression, speed: CLOUD_SPEED * (0.7 + random() * 0.6) });
  }
  return {
    group,
    update(dtMs) {
      for (const cloud of clouds) {
        const p = cloud.mesh.position;
        p.x += (cloud.speed * dtMs) / 1000;
        if (p.x > CLOUD_RANGE_X) p.x -= CLOUD_RANGE_X * 2;
        // Keep the cloud at the same angle in the sky as it drifts.
        p.y = heightAtDepression(cameraPosition, p.x, cloud.z, cloud.depression);
        cloud.mesh.rotation.y = faceYaw(p, cameraPosition);
      }
    },
  };
}

// Soft white streak texture: fades in and out along its length.
function streakTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return pixelTexture(canvas);
}

// Faint wind streaks that drift across the hill towards +x, fade in and out
// and start again somewhere else.
function createWindStreaks(cameraPosition) {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(STREAK_LENGTH, STREAK_THICKNESS);
  const map = streakTexture();
  const streaks = [];
  for (let i = 0; i < WIND3D_STREAK_COUNT; i++) {
    const material = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const streak = { mesh, age: 0, life: 1, baseY: 0, wave: 0 };
    respawn(streak);
    // Spread the first streaks over their lifetimes.
    streak.age = Math.random() * streak.life;
    group.add(mesh);
    streaks.push(streak);
  }

  function respawn(streak) {
    const x = -20 + Math.random() * 34;
    const z = -10 + Math.random() * 20;
    streak.baseY = Math.max(terrainHeight(x, z), GROUND_Y) + 0.6 + Math.random() * 2.2;
    streak.mesh.position.set(x, streak.baseY, z);
    streak.age = 0;
    streak.life = 2 + Math.random() * 2;
    streak.wave = Math.random() * Math.PI * 2;
  }

  return {
    group,
    update(timeMs, dtMs) {
      const dt = dtMs / 1000;
      for (const streak of streaks) {
        streak.age += dt;
        if (streak.age >= streak.life) respawn(streak);
        const p = streak.mesh.position;
        p.x += WIND3D_STREAK_SPEED * dt;
        p.y = streak.baseY + 0.15 * Math.sin(timeMs / 600 + streak.wave);
        streak.mesh.rotation.y = faceYaw(p, cameraPosition);
        streak.mesh.material.opacity = STREAK_OPACITY * Math.sin((Math.PI * streak.age) / streak.life);
      }
    },
  };
}
