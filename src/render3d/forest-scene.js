// The forest behind the far edge (docs/art-direction-v3-1.md section 6),
// drawn from the pure plan of forest.js: the far canopy wall, the tree
// rows and the undergrowth. One instanced mesh of upright billboards per
// sheet (8 at most), cut-out alpha with depth writes so the rows overlap
// correctly, placed by the meadow's own sprite placement path
// (placeUprightInstances in meadow-scene.js) so the pixel scale matches
// the plants. Every instance takes the haze of its base (haze.js
// hazeAmount), the wall strips add the top fade (wallTopHaze), then the
// brightness shift. Per quality row (src/render3d/quality.js):
//   forestWall, treeRows, undergrowth, forestLogs  what planForest plans
//   shadows   'blob' soft blob shadows under the trees and the shrubs,
//             saplings, logs and stumps; 'sun' their long sun shadows
//             (one extra instanced draw call per sheet); none otherwise
// A quality switch that changes any of these rebuilds the forest (section
// 8 of the doc): the old instanced meshes, shadows, geometries and materials are
// disposed first, so nothing leaks, and nothing else is touched (no game
// reset). The sheet textures are shared by every build and kept while a
// forest shows; a level with no forest (Low) disposes them as well.
// dispose() frees everything.
// Nothing here allocates per frame: the forest is still.

import * as THREE from 'three';
import { PX_WORLD, SPRITE_STRETCH_Y } from '../config.js';
import { artSource } from './art.js';
import { placeholderShape } from './art-assets.js';
import { castsShadow, drawsForest, forestInstanceGroups, forestShadowSpots, planForest } from './forest.js';
import { HAZE_COLOR, WALL_TOP_HAZE } from './haze.js';
import { blobShadows, placeUprightInstances, sunShadows } from './meadow-scene.js';
import { SPRITE_ALPHA_TEST } from './sprite-frames.js';
import { pixelTexture, uprightPlaneGeometry } from './sprites.js';

// The quality row keys that decide the plan.
const PLAN_KEYS = ['forestWall', 'treeRows', 'undergrowth', 'forestLogs'];

// Builds the forest into `scene`; `cameraPosition` is the fixed camera's
// position as a plain { x, y, z }. Returns { setFeatures(features), dispose() }.
export function createForest(scene, cameraPosition) {
  const textures = new Map(); // sheet -> texture, shared by every build
  const hazeColor = new THREE.Color(HAZE_COLOR);
  const root = new THREE.Group();
  root.name = 'forest';
  scene.add(root);
  let built = null; // { key, group } of the forest shown now

  const sheetTexture = (sheet) => {
    if (!textures.has(sheet)) textures.set(sheet, pixelTexture(artSource(sheet)));
    return textures.get(sheet);
  };

  // The meshes of one plan and the shadows of kind `shadows`.
  function buildForest(features) {
    const plan = planForest(features);
    const group = new THREE.Group();
    const sun = features.shadows === 'sun';
    for (const { sheet, items, wall } of forestInstanceGroups(plan)) {
      // The placement and the shadows read look (the frame), like the meadow.
      const placed = items.map((item) => ({ x: item.x, z: item.z, mirror: item.mirror, scale: item.scale, look: item.frame }));
      const mesh = forestBillboards(sheet, items, placed, cameraPosition, sheetTexture(sheet), hazeColor, wall);
      group.add(mesh);
      const shadowed = placed.filter((_, i) => castsShadow(items[i]));
      if (sun && !wall && shadowed.length) group.add(sunShadows(mesh, sheet, shadowed));
    }
    if (features.shadows === 'blob') group.add(blobShadows(forestShadowSpots(plan), 1));
    root.add(group);
    return group;
  }

  // Frees the instanced meshes (their instance buffers), geometries and
  // materials of `group` (not the shared textures).
  function disposeGroup(group) {
    root.remove(group);
    group.traverse((object) => {
      if (object.isInstancedMesh) object.dispose();
      if (object.geometry) object.geometry.dispose();
      if (object.material) object.material.dispose();
    });
  }

  function disposeTextures() {
    for (const texture of textures.values()) texture.dispose();
    textures.clear();
  }

  return {
    setFeatures(features) {
      const drawn = drawsForest(features);
      const key = drawn ? [...PLAN_KEYS, 'shadows'].map((name) => String(features[name])).join('|') : null;
      if (built?.key === key) return;
      if (built) disposeGroup(built.group);
      built = null;
      if (drawn) built = { key, group: buildForest(features) };
      else disposeTextures();
    },
    dispose() {
      if (built) disposeGroup(built.group);
      built = null;
      disposeTextures();
      scene.remove(root);
    },
  };
}

// One instanced mesh of the plan `items` of `sheet` (`placed` are the same
// items as the placement path reads them): frame, mirror, haze and
// brightness per instance; `wall` strips face straight down +z so they
// join without a seam, and take the top fade.
function forestBillboards(sheet, items, placed, cameraPosition, map, hazeColor, wall) {
  const { width, height, frames } = placeholderShape(sheet);
  const geometry = uprightPlaneGeometry(width, height);
  const looks = new Float32Array(items.length);
  const mirrors = new Float32Array(items.length);
  const haze = new Float32Array(items.length);
  const bright = new Float32Array(items.length);
  items.forEach((item, i) => {
    looks[i] = Math.min(Math.max(item.frame, 0), frames - 1);
    mirrors[i] = item.mirror ? 1 : 0;
    haze[i] = item.hazeAmount;
    bright[i] = item.brightness;
  });
  geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(looks, 1));
  geometry.setAttribute('aMirror', new THREE.InstancedBufferAttribute(mirrors, 1));
  geometry.setAttribute('aHaze', new THREE.InstancedBufferAttribute(haze, 1));
  geometry.setAttribute('aBright', new THREE.InstancedBufferAttribute(bright, 1));
  const material = forestMaterial(map, frames, height * PX_WORLD * SPRITE_STRETCH_Y, hazeColor, wall ? WALL_TOP_HAZE : 0);
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  mesh.name = sheet;
  placeUprightInstances(mesh, sheet, placed, cameraPosition, { faceCamera: !wall });
  mesh.computeBoundingSphere();
  return mesh;
}

// Lit cut-out material (alpha test, depth writes) of the forest: picks
// frame aLook of a sheet of `frames` frames, mirrored by aMirror; after the
// lighting the colour mixes aHaze (plus, on the wall, `topHaze` times the
// top fade wallTopHaze of the row's place in the strip) toward the haze
// colour, then takes the brightness shift aBright. Alpha is untouched.
function forestMaterial(map, frames, height, hazeColor, topHaze) {
  const material = new THREE.MeshLambertMaterial({ map, alphaTest: SPRITE_ALPHA_TEST });
  const uniforms = {
    uFrameWidth: { value: 1 / frames },
    uPlaneHeight: { value: height },
    uTopHaze: { value: topHaze },
    uHazeColor: { value: hazeColor },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aLook;
attribute float aMirror;
attribute float aHaze;
attribute float aBright;
uniform float uFrameWidth;
uniform float uPlaneHeight;
varying float vHaze;
varying float vBright;
varying float vStripV;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
vMapUv.x = (mix(vMapUv.x, 1.0 - vMapUv.x, aMirror) + aLook) * uFrameWidth;
#endif
vHaze = aHaze;
vBright = aBright;
vStripV = 1.0 - position.y / uPlaneHeight;`);
    // Same formulas as hazeAmount and wallTopHaze in haze.js.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTopHaze;
uniform vec3 uHazeColor;
varying float vHaze;
varying float vBright;
varying float vStripV;`)
      .replace('#include <opaque_fragment>', `{
  float h = clamp(vHaze + uTopHaze * (1.0 - smoothstep(0.0, 1.0, vStripV)), 0.0, 1.0);
  outgoingLight = mix(outgoingLight, uHazeColor, h) * vBright;
}
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => (topHaze > 0 ? 'forest-wall' : 'forest-billboard');
  return material;
}
