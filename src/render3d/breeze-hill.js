// Map 1, Windy Spring Breeze Hill (docs/art-direction-hd2d.md section C):
// everything around the board. A low-poly rolling hill that is flat under
// the board, grass colours, patches of wildflowers (instanced billboards), a
// few blossoming trees, distant hills, a sky gradient, drifting clouds,
// light fog and faint drifting wind streaks.
//
// The camera looks steeply down, so the hill falls away behind the board
// and the sky shows only in a band at the top of the view, above the crest.

import * as THREE from 'three';
import {
  CHARACTER_X, CLOUD_COUNT, CLOUD_PX_WORLD, CLOUD_SPEED, CLOUD_VARIANTS, FOG_FAR, FOG_NEAR, WILDFLOWER_COUNT,
  WIND3D_STREAK_COUNT, WIND3D_STREAK_SPEED,
} from '../config.js';
import { artFrame, artSource } from './art.js';
import { ART } from './art-assets.js';
import { FLOWER_VARIANTS } from './placeholder-art.js';
import { seededRandom } from './seeded-random.js';
import { faceYaw } from './sprite-frames.js';
import { createInstancedBillboards, pixelTexture, uprightPlaneGeometry } from './sprites.js';
import { GROUND_Y, plateauDistance, terrainHeight } from './terrain.js';

const COLORS = {
  skyTop: '#4f9fe4',
  skyMid: '#9fd3f3',
  haze: '#e2f1ec', // the bottom of the sky and the fog colour
  grass: [0x7cc85a, 0x6dbb4f, 0x86d063, 0x74c255],
  grassLow: 0x5a9e52, // grass on the lower slopes
  trunk: 0x7a5236,
  blossom: [0xffb7d0, 0xff9ec4, 0xffd0e0, 0xfff0f4],
  distantHills: [0x8dbb98, 0x7fae8a, 0x9cc6a4, 0x86b49b],
};

const TERRAIN = { minX: -48, maxX: 48, minZ: -36, maxZ: 26, cell: 2 };

// Board area plus a margin, kept clear of flowers.
const BOARD_CLEAR = 8.3;
const FLOWER_PATCH_RADIUS = 1.8;
const FLOWER_PATCHES = [
  [-11.5, -6], [11.5, -5.5], [-12, 5.5], [12.5, 6.5], [-4, 9.4], [5, 9.6], [-15.5, 0.5],
  [15.5, 1.5], [0.5, -9.2], [-8, -9.4], [8.5, -9.6], [-10.5, 9], [10, -1.5], [-10, -2],
];
// Keep the spots where the characters stand clear.
const CHARACTER_CLEAR = [{ x: -CHARACTER_X, z: 0, r: 1.5 }, { x: CHARACTER_X, z: 0, r: 1.6 }];

const TREES = [
  { x: -13, z: -8.5, scale: 1 },
  { x: 13.5, z: -8, scale: 1.1 },
  { x: -12.8, z: 5, scale: 0.9 },
  { x: 12.6, z: 4.5, scale: 0.85 },
  { x: -5.5, z: -12.5, scale: 0.8 },
  { x: 6.5, z: -12, scale: 0.75 },
];

// Distant hills sit far behind the crest. Their peaks are placed at these
// angles below the horizon, as seen from the camera, so they show in the
// band of sky at the top of the fixed view.
const DISTANT_HILLS = [
  { x: -55, z: -70, radius: 22, depressionDeg: 39.2 },
  { x: -20, z: -78, radius: 26, depressionDeg: 38.6 },
  { x: 18, z: -66, radius: 20, depressionDeg: 39.8 },
  { x: 52, z: -74, radius: 24, depressionDeg: 38.9 },
  { x: -35, z: -95, radius: 30, depressionDeg: 38.0 },
  { x: 35, z: -100, radius: 32, depressionDeg: 37.9 },
  { x: 0, z: -110, radius: 34, depressionDeg: 37.6 },
];
const DISTANT_HILL_HEIGHT = 16;

const CLOUD_DEPRESSION_DEG = [38.0, 38.6, 39.3]; // cloud heights in the sky band
const CLOUD_RANGE_X = 70; // clouds wrap around between -70 and +70
const STREAK_LENGTH = 3;
const STREAK_THICKNESS = 0.06;
const STREAK_OPACITY = 0.35;

// Builds the scene around the board and returns { update(timeMs, dtMs) }
// for the moving parts. `cameraPosition` is the fixed camera's position.
export function buildBreezeHill(scene, cameraPosition) {
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(COLORS.haze, FOG_NEAR, FOG_FAR);
  scene.add(createTerrain());
  scene.add(createDistantHills(cameraPosition));
  for (const tree of TREES) scene.add(createTree(tree));
  for (const mesh of createWildflowers(cameraPosition)) scene.add(mesh);
  const clouds = createClouds(cameraPosition);
  scene.add(clouds.group);
  const wind = createWindStreaks(cameraPosition);
  scene.add(wind.group);
  return {
    update(timeMs, dtMs) {
      clouds.update(dtMs);
      wind.update(timeMs, dtMs);
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

// Low-poly hill: a coarse height grid with one flat grass colour per triangle.
function createTerrain() {
  const { minX, maxX, minZ, maxZ, cell } = TERRAIN;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const geometry = new THREE.PlaneGeometry(width, depth, width / cell, depth / cell)
    .rotateX(-Math.PI / 2)
    .translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
    .toNonIndexed();
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, terrainHeight(positions.getX(i), positions.getZ(i)));
  }

  const random = seededRandom(11);
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  const lowColor = new THREE.Color(COLORS.grassLow);
  for (let i = 0; i < positions.count; i += 3) {
    const cy = (positions.getY(i) + positions.getY(i + 1) + positions.getY(i + 2)) / 3;
    color.setHex(COLORS.grass[Math.floor(random() * COLORS.grass.length)]);
    // Lower slopes turn a deeper green.
    const low = Math.min(Math.max((GROUND_Y - cy) / 12, 0), 1);
    color.lerp(lowColor, low * 0.8);
    for (let v = 0; v < 3; v++) color.toArray(colors, (i + v) * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

// Height at which something `depressionDeg` below the horizon, seen from
// the camera, appears at horizontal position (x, z).
function heightAtDepression(cameraPosition, x, z, depressionDeg) {
  const distance = Math.hypot(x - cameraPosition.x, z - cameraPosition.z);
  return cameraPosition.y - distance * Math.tan((depressionDeg * Math.PI) / 180);
}

// Big soft low-poly cones far away; the fog fades them into the haze.
function createDistantHills(cameraPosition) {
  const group = new THREE.Group();
  DISTANT_HILLS.forEach((hill, i) => {
    const peakY = heightAtDepression(cameraPosition, hill.x, hill.z, hill.depressionDeg);
    const geometry = new THREE.ConeGeometry(hill.radius, DISTANT_HILL_HEIGHT, 7, 2);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color: COLORS.distantHills[i % COLORS.distantHills.length], flatShading: true }),
    );
    mesh.scale.y = 0.9 + (i % 3) * 0.1;
    mesh.position.set(hill.x, peakY - (DISTANT_HILL_HEIGHT * mesh.scale.y) / 2, hill.z);
    mesh.rotation.y = i * 0.7;
    group.add(mesh);
  });
  return group;
}

// A blossoming tree: a short trunk and a crown of pink low-poly puffs.
const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.26, 1.8, 6).translate(0, 0.9, 0);
const puffGeometry = new THREE.IcosahedronGeometry(1, 0);
const trunkMaterial = new THREE.MeshLambertMaterial({ color: COLORS.trunk, flatShading: true });
const blossomMaterials = COLORS.blossom.map(
  (color) => new THREE.MeshLambertMaterial({ color, flatShading: true }),
);
const PUFFS = [
  { x: 0, y: 2.3, z: 0, r: 1.05 },
  { x: -0.75, y: 1.95, z: 0.2, r: 0.75 },
  { x: 0.8, y: 2.0, z: -0.1, r: 0.8 },
  { x: 0.15, y: 2.05, z: 0.75, r: 0.7 },
  { x: -0.2, y: 2.85, z: -0.25, r: 0.65 },
];

function createTree({ x, z, scale }) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.castShadow = true;
  tree.add(trunk);
  PUFFS.forEach((p, i) => {
    const puff = new THREE.Mesh(puffGeometry, blossomMaterials[i % blossomMaterials.length]);
    puff.position.set(p.x, p.y, p.z);
    puff.scale.setScalar(p.r);
    puff.rotation.set(i, i * 2, 0);
    puff.castShadow = true;
    tree.add(puff);
  });
  tree.position.set(x, terrainHeight(x, z) - 0.05, z);
  tree.scale.setScalar(scale);
  return tree;
}

// Patches of wildflowers and grass tufts: one instanced mesh per variant.
function createWildflowers(cameraPosition) {
  const random = seededRandom(5);
  const byVariant = new Map(FLOWER_VARIANTS.map((v) => [v, []]));
  const perPatch = Math.ceil(WILDFLOWER_COUNT / FLOWER_PATCHES.length);
  let placed = 0;
  for (const [px, pz] of FLOWER_PATCHES) {
    let inPatch = 0;
    for (let tries = 0; tries < perPatch * 3 && inPatch < perPatch && placed < WILDFLOWER_COUNT; tries++) {
      // Roughly round, slightly wide patches that are denser in the middle.
      const angle = random() * Math.PI * 2;
      const dist = FLOWER_PATCH_RADIUS * random();
      const x = px + Math.cos(angle) * dist * 1.4;
      const z = pz + Math.sin(angle) * dist;
      const variant = FLOWER_VARIANTS[Math.floor(random() * FLOWER_VARIANTS.length)];
      if (!flowerSpotIsFree(x, z)) continue;
      byVariant.get(variant).push({ x, y: terrainHeight(x, z), z });
      inPatch++;
      placed++;
    }
  }
  const meshes = [];
  for (const [variant, positions] of byVariant) {
    if (positions.length === 0) continue;
    meshes.push(createInstancedBillboards({ sheet: artSource(ART.flower[variant]), positions, cameraPosition }));
  }
  return meshes;
}

function flowerSpotIsFree(x, z) {
  if (Math.abs(x) < BOARD_CLEAR && Math.abs(z) < BOARD_CLEAR) return false;
  if (CHARACTER_CLEAR.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) return false;
  // Flowers grow on the gentle top of the hill, not down the steep slopes.
  return plateauDistance(x, z) < 3;
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
