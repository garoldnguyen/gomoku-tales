// The meadow around the farm field (docs/art-direction-v3.md section 6),
// drawn from the pure plan of meadow.js: the ground, trees,
// bushes, hay bales, grass tufts and the 13 flower kinds. Every kind is one
// instanced mesh of upright billboards (one draw call each) whose instances
// pick their look (sheet frame) in the shader. Per quality row
// (src/render3d/quality.js):
//   ground         'mown' flat stripes in two greens, 'painted' a mottled
//                  meadow with grass tufts, 'painted-ripples' plus slow
//                  lighter wind ripples
//   scenery        trees, bushes and hay bales
//   meadowFlowers  'off', 'still' or 'sway' (a vertex shader lean, and
//                  dandelion puffs letting seed flecks go)
//   groundFog      the soft ground edge: the ground mixes toward the fog
//                  colour near the far edge (haze.js groundFogAmount)
//   floorShade     the forest floor shade behind the far rows (haze.js
//                  floorShadeAmount)
//   shadows        'blob' soft blob shadows under every tree, bush, bale
//                  and flower patch; 'sun' the long sun shadows of every
//                  tree, bush, bale and flower instead (sheared
//                  silhouettes falling toward the lower right, one
//                  instanced draw call per kind)
// Nothing here allocates per frame.

import * as THREE from 'three';
import {
  DANDELION_FLECK_MS, DANDELION_FLECK_POOL, GROUND_STRIPE_CELLS, MEADOW_SEED, MEADOW_SHADOW_LIFT, PX_WORLD,
  SPRITE_STRETCH_Y, SUN_SHADOW_MEADOW_FLOWERS, SWAY_PERIOD_MS,
} from '../config.js';
import { artMeta, artSource } from './art.js';
import { ART, placeholderShape } from './art-assets.js';
import {
  FLOOR_SHADE_COLOR, FLOOR_SHADE_MAX, FLOOR_SHADE_Z, GROUND_EDGE_FEATHER_Z, GROUND_FOG_COLOR, GROUND_FOG_END_Z, GROUND_FOG_MAX,
} from './haze.js';
import {
  dandelionPuffs, meadowInstanceGroups, meadowShadowSpots, mergeMeadowPlans, planMeadow, planMeadowStrips,
} from './meadow.js';
import { drawsForest, skipForestZone } from './forest.js';
import { QUALITY_LEVELS, QUALITY_ORDER } from './quality.js';
import { effectRandom, seededRandom } from './seeded-random.js';
import { anchorForward, anchorShift, faceYaw, SPRITE_ALPHA_TEST } from './sprite-frames.js';
import {
  blobShadowMaterial, pixelTexture, PLANT_SWAY, SHADOW_DEPTH, sunShadowGeometry, sunShadowMaterial, uprightPlaneGeometry,
} from './sprites.js';
import { FAR_EDGE_Z, farEdgeWave } from './horizon.js';
import { GROUND_Y, TERRAIN_GRID } from './terrain.js';
import { bitKinds, metaAnchor } from './v3-meta.js';
import {
  createGustClock, createPuffReleases, fleckSpeed, plantSwayAmplitudePx, swayAmplitudePx, swayLeanSide, swayPhase,
  swayRowFraction, WIND_GROUND,
} from './wind.js';

const PAINT_TILE_CELLS = 8; // the painted meadow texture repeats every 8 cells
const PAINT_TILE_PX = PAINT_TILE_CELLS * 32; // one texel per art pixel
const COLORS = {
  stripes: ['#5fb247', '#4fa13f'], // Low: two mown greens
  paint: ['#4a9a40', '#58aa45', '#66b94b', '#74c255'], // dark to light
};
const GROUND_EDGE_STEP = 0.5; // world units between the ground's columns, for the wavy far edge
// The ground and the field share the plane y = 0: the ground is drawn a
// little deeper so the field always wins.
const BEHIND_FIELD = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
// The ground stays in the opaque list (drawn before the sprites and decals
// on it) but blends by its alpha, which only drops at the feathered far
// edge, over the sky and the ridges drawn before it.
const EDGE_BLENDING = {
  blending: THREE.CustomBlending,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
};
// A quality row that draws the forest, for the forest zone above.
const FOREST_LEVEL = QUALITY_ORDER.map((level) => QUALITY_LEVELS[level]).find(drawsForest);
const RIPPLE_SPEED = 0.55; // radians of the ripple wave per second
const RIPPLE_WAVE = 0.85; // radians per world unit along the wind
const PATCH_SHADOW_OPACITY = 0.55; // a patch shadow is fainter than a sprite's
const FLECK_RISE = 0.35; // world units per second a seed fleck rises
const FLECK_BOB = 0.12; // world units of up and down while it drifts
const PUFF_TOP = 0.8; // the seed head is this far up the dandelion

// Builds the meadow into `scene`. On High it also drives PLANT_SWAY, the sway of the resting X and O
// plants on the board (half the meadow's amplitude, same wind and gusts).
// Returns { setFeatures(features), update(timeMs, dtMs) }.
export function createMeadow(scene, cameraPosition) {
  // The central meadow and the two side strips a window wider than 21:9
  // shows (docs/art-direction-v3-1.md section 3.3). Every kind in it is
  // hidden on Low by the switches below (flowers, scenery, tufts), so the
  // strips show on Medium and High only.
  // The forest zone (docs/art-direction-v3-1.md section 6.7): the levels
  // that draw the forest skip every meadow item whose base is inside it.
  // The meadow is built once with the forest's plan: the one level without
  // the forest (Low) hides every item of the plan (its tuft, scenery and
  // flower switches are off), so this is the only plan any level draws.
  const plan = skipForestZone(mergeMeadowPlans(planMeadow(MEADOW_SEED), planMeadowStrips(MEADOW_SEED)), FOREST_LEVEL);
  const ground = createGround();
  scene.add(ground.mesh);

  // Shared sway state: every swaying material reads these uniforms.
  const sway = { uSwayAngle: { value: 0 }, uSwayPx: { value: 0 } };

  const scenery = new THREE.Group();
  const trees = billboards(ART.v3.trees, plan.trees, cameraPosition, null); // mirrored and shaded per tree
  const bushes = billboards(ART.v3.bushes, plan.bushes, cameraPosition, null);
  const baleItems = plan.bales.map((b) => ({ ...b, look: 0 }));
  const bales = billboards(ART.v3.hayBale, baleItems, cameraPosition, null);
  scenery.add(trees, bushes, bales);
  const shadowSpots = meadowShadowSpots(plan);
  const sceneryShadows = blobShadows(shadowSpots.scenery, 1);
  const scenerySunShadows = new THREE.Group();
  scenerySunShadows.add(
    sunShadows(trees, ART.v3.trees, plan.trees),
    sunShadows(bushes, ART.v3.bushes, plan.bushes),
    sunShadows(bales, ART.v3.hayBale, baleItems),
  );
  scenery.add(sceneryShadows, scenerySunShadows);
  scene.add(scenery);

  const tufts = billboards(ART.v3.grassTufts, plan.tufts, cameraPosition, sway);
  scene.add(tufts);

  const flowers = new THREE.Group();
  const flowerSunShadows = new THREE.Group();
  for (const group of meadowInstanceGroups(plan)) {
    const name = ART.v3.flower[group.species];
    const mesh = billboards(name, group.items, cameraPosition, sway);
    flowers.add(mesh);
    if (SUN_SHADOW_MEADOW_FLOWERS) flowerSunShadows.add(sunShadows(mesh, name, group.items));
  }
  const flowerShadows = blobShadows(shadowSpots.patches, PATCH_SHADOW_OPACITY);
  flowers.add(flowerShadows, flowerSunShadows);
  scene.add(flowers);

  const flecks = createSeedFlecks(dandelionPuffs(plan), cameraPosition);
  flowers.add(flecks.mesh);

  const gusts = createGustClock(effectRandom(MEADOW_SEED + 1));
  let swaying = false;
  let rippling = false;

  return {
    setFeatures(features) {
      ground.setStyle(features.ground);
      ground.setHaze(features.groundFog, features.floorShade);
      rippling = features.ground === 'painted-ripples';
      tufts.visible = features.ground !== 'mown';
      scenery.visible = features.scenery;
      flowers.visible = features.meadowFlowers !== 'off';
      swaying = features.meadowFlowers === 'sway';
      if (!swaying) {
        sway.uSwayPx.value = 0;
        PLANT_SWAY.uSwayPx.value = 0;
      }
      flecks.mesh.visible = swaying;
      if (!swaying) flecks.clear();
      const blob = features.shadows === 'blob';
      const sun = features.shadows === 'sun';
      sceneryShadows.visible = blob;
      flowerShadows.visible = blob;
      scenerySunShadows.visible = sun;
      flowerSunShadows.visible = sun;
    },

    update(timeMs, dtMs) {
      if (rippling) ground.setRipple(timeMs);
      if (!swaying) return;
      const gust = gusts.strength(timeMs);
      sway.uSwayAngle.value = ((timeMs % SWAY_PERIOD_MS) / SWAY_PERIOD_MS) * Math.PI * 2;
      sway.uSwayPx.value = swayAmplitudePx(gust);
      PLANT_SWAY.uSwayAngle.value = sway.uSwayAngle.value;
      PLANT_SWAY.uSwayPx.value = plantSwayAmplitudePx(gust);
      flecks.update(timeMs, dtMs, gust);
    },
  };
}

// The ground: one flat rectangle at y = 0 (TERRAIN_GRID) that reaches past
// the left, right and bottom of the screen and ends at the far edge, the
// horizon (horizon.js farEdgeZ), drawn there as a gentle wavy line
// (farEdgeWave). No heights, no rim, no dome. Textured in world space. Low
// uses two greens in GROUND_STRIPE_CELLS-wide stripes across the whole
// ground; Medium and High a painted mottled tile, and High adds slow
// lighter ripples in the shader that travel with the wind. The field lies
// on the same plane, so the ground is pushed back in depth under it.
function createGround() {
  const { minX, maxX, minZ, maxZ } = TERRAIN_GRID;
  const geometry = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, Math.round((maxX - minX) / GROUND_EDGE_STEP), 1)
    .rotateX(-Math.PI / 2)
    .translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const edgeZ = new Float32Array(position.count); // the far edge's z in each vertex's column
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    position.setY(i, GROUND_Y); // exactly flat, without the rounding of the turn above
    // The far row follows the wavy far edge; the other edges stay straight.
    edgeZ[i] = minZ + farEdgeWave(x);
    if (Math.abs(position.getZ(i) - minZ) < 1e-6) position.setZ(i, edgeZ[i]);
    uv.setXY(i, x, position.getZ(i)); // world units; each texture scales them with repeat
  }
  geometry.setAttribute('aEdgeZ', new THREE.BufferAttribute(edgeZ, 1));

  const stripes = repeating(stripeCanvas());
  // Two texels per period: stripes GROUND_STRIPE_CELLS wide whose edges lie
  // on cell edges of the field.
  stripes.repeat.set(1, 1 / (2 * GROUND_STRIPE_CELLS));
  stripes.offset.set(0, 0.25);
  const haze = {
    uGroundFog: { value: 0 },
    uFloorShade: { value: 0 },
    uGroundFogColor: { value: new THREE.Color(GROUND_FOG_COLOR) },
    uFloorShadeColor: { value: new THREE.Color(FLOOR_SHADE_COLOR) },
  };
  const mown = new THREE.MeshLambertMaterial({ map: stripes, ...BEHIND_FIELD, ...EDGE_BLENDING });
  mown.onBeforeCompile = (shader) => withGroundHaze(shader, haze);
  mown.customProgramCacheKey = () => 'meadow-ground-mown';

  const paint = repeating(paintCanvas());
  paint.repeat.set(1 / PAINT_TILE_CELLS, 1 / PAINT_TILE_CELLS);
  const painted = new THREE.MeshLambertMaterial({ map: paint, ...BEHIND_FIELD, ...EDGE_BLENDING });
  const ripple = { uRipple: { value: 0 }, uRipplePhase: { value: 0 }, uWind: { value: new THREE.Vector2(WIND_GROUND.x, WIND_GROUND.z) } };
  painted.onBeforeCompile = (shader) => {
    withGroundHaze(shader, haze);
    Object.assign(shader.uniforms, ripple);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uRipple;
uniform float uRipplePhase;
uniform vec2 uWind;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
if (uRipple > 0.0) {
  // Snapped to the art pixel grid so the ripples stay crisp pixels.
  vec2 p = floor(vGroundXZ * 32.0) / 32.0;
  float along = dot(p, uWind);
  float across = dot(p, vec2(-uWind.y, uWind.x));
  float wave = sin(along * ${RIPPLE_WAVE.toFixed(3)} - uRipplePhase + 1.7 * sin(across * 0.31) + 0.6 * sin(across * 0.83 + along * 0.2));
  float light = step(0.9, wave) * 0.6 + step(0.97, wave) * 0.4;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.16 + vec3(0.015, 0.03, 0.0), light * uRipple * 0.7);
}`);
  };
  painted.customProgramCacheKey = () => 'meadow-ground-ripple';

  const mesh = new THREE.Mesh(geometry, painted);
  return {
    mesh,
    setStyle(style) {
      mesh.material = style === 'mown' ? mown : painted;
      ripple.uRipple.value = style === 'painted-ripples' ? 1 : 0;
    },
    // The soft ground edge and the forest floor shade on or off.
    setHaze(groundFog, floorShade) {
      haze.uGroundFog.value = groundFog ? 1 : 0;
      haze.uFloorShade.value = floorShade ? 1 : 0;
    },
    setRipple(timeMs) {
      ripple.uRipplePhase.value = ((timeMs / 1000) * RIPPLE_SPEED) % (Math.PI * 2);
    },
  };
}

// The ground's own haze (docs/art-direction-v3-1.md sections 5.4 and 5.5),
// the GLSL of groundFogAmount and floorShadeAmount in haze.js: after the
// lighting, the ground mixes toward the forest floor shade colour (High),
// then toward the fog colour near the far edge, and its alpha feathers
// over the last GROUND_EDGE_FEATHER_Z before the edge (groundEdgeAlpha).
// Only the ground, never the sprites. The ground mesh sits at the origin,
// so position.xz is its world x and z.
function withGroundHaze(shader, haze) {
  Object.assign(shader.uniforms, haze);
  const f = (value) => value.toFixed(5);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aEdgeZ;\nvarying vec2 vGroundXZ;\nvarying float vEdge;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = position.xz;\nvEdge = position.z - aEdgeZ;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec2 vGroundXZ;
varying float vEdge;
uniform float uGroundFog;
uniform float uFloorShade;
uniform vec3 uGroundFogColor;
uniform vec3 uFloorShadeColor;`)
    .replace('#include <opaque_fragment>', `{
  float z = vGroundXZ.y;
  float shade = uFloorShade * ${f(FLOOR_SHADE_MAX)} * smoothstep(${f(FAR_EDGE_Z)}, ${f(FLOOR_SHADE_Z.in)}, z)
    * (1.0 - smoothstep(${f(FLOOR_SHADE_Z.out)}, ${f(FLOOR_SHADE_Z.end)}, z));
  outgoingLight = mix(outgoingLight, uFloorShadeColor, shade);
  float fog = uGroundFog * ${f(GROUND_FOG_MAX)} * (1.0 - smoothstep(${f(FAR_EDGE_Z)}, ${f(GROUND_FOG_END_Z)}, z));
  outgoingLight = mix(outgoingLight, uGroundFogColor, fog);
  diffuseColor.a *= smoothstep(0.0, ${f(GROUND_EDGE_FEATHER_Z)}, vEdge);
}
#include <opaque_fragment>`);
}

function repeating(canvas) {
  const texture = pixelTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function newCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function stripeCanvas() {
  const canvas = newCanvas(1, 2);
  const ctx = canvas.getContext('2d');
  COLORS.stripes.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, i, 1, 1);
  });
  return canvas;
}

// The painted meadow tile: soft blotches of four greens from tileable
// value noise, with a little per-pixel grain so the edges look painted.
function paintCanvas() {
  const size = PAINT_TILE_PX;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const random = seededRandom(MEADOW_SEED + 7);
  const lattice = (period) => {
    const values = new Float32Array(period * period);
    for (let i = 0; i < values.length; i++) values[i] = random();
    return (x, y) => values[((y % period) + period) % period * period + ((x % period) + period) % period];
  };
  // Smooth tileable noise with `period` lattice cells across the tile.
  const octave = (period) => {
    const at = lattice(period);
    const step = size / period;
    return (px, py) => {
      const gx = px / step;
      const gy = py / step;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = smooth(gx - x0);
      const fy = smooth(gy - y0);
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
      return top + (bottom - top) * fy;
    };
  };
  const big = octave(4);
  const mid = octave(8);
  const small = octave(16);
  const rgb = COLORS.paint.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = 0.55 * big(x, y) + 0.3 * mid(x, y) + 0.15 * small(x, y) + (random() - 0.5) * 0.06;
      const shade = n < 0.36 ? 0 : n < 0.5 ? 1 : n < 0.64 ? 2 : 3;
      const i = (y * size + x) * 4;
      const color = rgb[shade];
      image.data[i] = color[0];
      image.data[i + 1] = color[1];
      image.data[i + 2] = color[2];
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

// One instanced mesh of upright billboards of sheet `name`, one per item
// { x, z, look, scale?, mirror?, brightness? }: each stands on the ground at (x, z) with the
// sheet's anchor pixel (v3-meta.json) on it, turned to face the fixed
// camera, showing frame `look`, flipped left to right when `mirror` (in
// the shader: a negative instance scale would turn the plane's back to
// the camera) and its colour times `brightness`. With `sway` (the shared sway uniforms) it
// leans downwind in the vertex shader: whole art pixels, growing with the
// square of the height, the root fixed, each plant with its own phase.
function billboards(name, items, cameraPosition, sway) {
  const { width, height, frames } = placeholderShape(name);
  const anchor = metaAnchor(artMeta(), name);
  const geometry = sway ? swayPlaneGeometry(width, height, anchor) : uprightPlaneGeometry(width, height);
  if (!sway) geometry.setAttribute('aSwayH', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
  const looks = new Float32Array(items.length);
  const phases = new Float32Array(items.length);
  const windSide = new Float32Array(items.length);
  const mirrors = new Float32Array(items.length);
  const tinted = items.some((item) => item.brightness !== undefined);
  const tint = new THREE.Color();
  const material = meadowMaterial(artSource(name), frames, sway);
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  placeUprightInstances(mesh, name, items, cameraPosition);
  items.forEach((item, i) => {
    const yaw = faceYaw({ x: item.x, z: item.z }, cameraPosition);
    mirrors[i] = item.mirror ? 1 : 0;
    if (tinted) mesh.setColorAt(i, tint.setScalar(item.brightness ?? 1));
    looks[i] = Math.min(Math.max(item.look ?? 0, 0), frames - 1);
    phases[i] = swayPhase(item.x, item.z);
    // Which way downwind lies along the plane's own width: +1 or -1, so
    // the lean stays whole art pixels.
    windSide[i] = swayLeanSide(Math.cos(yaw), Math.sin(yaw));
  });
  geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(looks, 1));
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  geometry.setAttribute('aWindSide', new THREE.InstancedBufferAttribute(windSide, 1));
  geometry.setAttribute('aMirror', new THREE.InstancedBufferAttribute(mirrors, 1));
  mesh.computeBoundingSphere();
  return mesh;
}

// The sprite placement path of every upright billboard of the meadow and
// the forest (forest-scene.js): writes the instance matrix of each item
// { x, z, scale?, mirror? } of the instanced `mesh` of sheet `name`, so
// it stands on the ground at (x, z) with the sheet's anchor pixel
// (v3-meta.json, forest-meta.json) on it, turned to face the fixed camera
// at `cameraPosition`, or facing straight down +z when `faceCamera` is
// false (the seamless forest wall strips). A mirrored frame has its anchor
// pixel on the other side. Built once, never per frame.
export function placeUprightInstances(mesh, name, items, cameraPosition, { faceCamera = true } = {}) {
  const { width, height } = placeholderShape(name);
  const anchor = metaAnchor(artMeta(), name);
  const { side, lift } = anchorShift(width, height, anchor, PX_WORLD, SPRITE_STRETCH_Y);
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  items.forEach((item, i) => {
    const y = GROUND_Y;
    const ground = { x: item.x, y, z: item.z };
    const yaw = faceCamera ? faceYaw(ground, cameraPosition) : 0;
    const s = item.scale ?? 1;
    const forward = anchorForward(lift * s, ground, cameraPosition);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const shift = (item.mirror ? -side : side) * s;
    position.set(item.x + shift * cos + forward * sin, y, item.z + forward * cos - shift * sin);
    rotation.setFromAxisAngle(up, yaw);
    matrix.compose(position, rotation, scale.set(s, s, s));
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

// An upright plane like uprightPlaneGeometry, but one quad per art pixel
// row with its own vertices, each carrying aSwayH, the row's height
// fraction (swayRowFraction, measured from the anchor row). A whole row
// then leans by the same whole number of pixels: no row is sheared by a
// part of a pixel.
function swayPlaneGeometry(width, height, anchor) {
  const geometry = uprightPlaneGeometry(width, height, PX_WORLD, SPRITE_STRETCH_Y, height).toNonIndexed();
  const position = geometry.attributes.position;
  const rowHeight = PX_WORLD * SPRITE_STRETCH_Y;
  const rootRow = anchor ? height - 1 - anchor.y : 0;
  const swayH = new Float32Array(position.count);
  for (let i = 0; i < position.count; i += 3) {
    const bottom = Math.min(position.getY(i), position.getY(i + 1), position.getY(i + 2));
    swayH.fill(swayRowFraction(Math.round(bottom / rowHeight), height, rootRow), i, i + 3);
  }
  geometry.setAttribute('aSwayH', new THREE.BufferAttribute(swayH, 1));
  return geometry;
}

// Lit cutout material for meadow billboards: picks frame aLook of a sheet
// of `frames` frames and, given the sway uniforms, leans the plant.
function meadowMaterial(sheet, frames, sway) {
  const material = new THREE.MeshLambertMaterial({ map: pixelTexture(sheet), alphaTest: SPRITE_ALPHA_TEST });
  const uniforms = {
    uFrameWidth: { value: 1 / frames },
    uSwayAngle: sway?.uSwayAngle ?? { value: 0 },
    uSwayPx: sway?.uSwayPx ?? { value: 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aLook;
attribute float aPhase;
attribute float aWindSide;
attribute float aSwayH;
attribute float aMirror;
uniform float uFrameWidth;
uniform float uSwayAngle;
uniform float uSwayPx;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
vMapUv.x = (mix(vMapUv.x, 1.0 - vMapUv.x, aMirror) + aLook) * uFrameWidth;
#endif`)
      // Same formula as swayLeanPx in wind.js.
      .replace('#include <begin_vertex>', `#include <begin_vertex>
if (uSwayPx > 0.0) {
  float h = aSwayH;
  float wave = 0.5 + 0.5 * sin(uSwayAngle + aPhase);
  float leanPx = floor(uSwayPx * h * h * wave + 0.5);
  transformed.x += leanPx * ${PX_WORLD.toFixed(6)} * aWindSide;
}`);
  };
  material.customProgramCacheKey = () => 'meadow-billboard';
  return material;
}

// One mesh of soft blob shadows { x, z, r }: flat quads lying
// MEADOW_SHADOW_LIFT (0) above the flat ground, drawn over it by polygon offset. Built once, one draw call.
export function blobShadows(spots, opacity) {
  const material = blobShadowMaterial().clone();
  material.opacity *= opacity; // drawn over the ground by its polygon offset (ON_SURFACE)
  const positions = new Float32Array(spots.length * 12);
  const uvs = new Float32Array(spots.length * 8);
  const indices = [];
  const y = GROUND_Y + MEADOW_SHADOW_LIFT;
  spots.forEach((spot, i) => {
    const halfZ = spot.r * SHADOW_DEPTH;
    positions.set([
      spot.x - spot.r, y, spot.z - halfZ, spot.x + spot.r, y, spot.z - halfZ,
      spot.x - spot.r, y, spot.z + halfZ, spot.x + spot.r, y, spot.z + halfZ,
    ], i * 12);
    uvs.set([0, 1, 1, 1, 0, 0, 1, 0], i * 8);
    const a = i * 4;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); // facing up
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry, material);
}

// The long sun shadows of the billboards `mesh` (made by billboards() from
// sheet `name` and `items`): one instanced mesh of flat sheared
// silhouettes (sunShadowGeometry in sprites.js), each with its root under
// the item's anchor pixel, showing the item's frame (look) and mirroring,
// with the billboards' own texture. Built once, one draw call.
export function sunShadows(mesh, name, items) {
  const { width, height, frames } = placeholderShape(name);
  const anchor = metaAnchor(artMeta(), name);
  const { side } = anchorShift(width, height, anchor, PX_WORLD, SPRITE_STRETCH_Y);
  // A copy: the per-instance attributes below belong to this mesh only.
  const geometry = sunShadowGeometry(width, height, anchor ? height - 1 - anchor.y : 0).clone();
  const looks = new Float32Array(items.length);
  const mirrors = new Float32Array(items.length);
  const uniforms = { uFrameWidth: { value: 1 / frames } };
  const material = sunShadowMaterial(mesh.material.map, {
    key: 'meadow-sun-shadow',
    vertex: (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute float aLook;
attribute float aMirror;
uniform float uFrameWidth;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
vMapUv.x = (mix(vMapUv.x, 1.0 - vMapUv.x, aMirror) + aLook) * uFrameWidth;
#endif`);
    },
  });
  const shadows = new THREE.InstancedMesh(geometry, material, items.length);
  const matrix = new THREE.Matrix4();
  items.forEach((item, i) => {
    const s = item.scale ?? 1;
    // A mirrored frame has its anchor pixel on the other side.
    const shift = (item.mirror ? -side : side) * s;
    matrix.makeScale(s, 1, s).setPosition(item.x + shift, GROUND_Y, item.z);
    shadows.setMatrixAt(i, matrix);
    looks[i] = Math.min(Math.max(item.look ?? 0, 0), frames - 1);
    mirrors[i] = item.mirror ? 1 : 0;
  });
  geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(looks, 1));
  geometry.setAttribute('aMirror', new THREE.InstancedBufferAttribute(mirrors, 1));
  shadows.instanceMatrix.needsUpdate = true;
  shadows.computeBoundingSphere();
  return shadows;
}

// Seed flecks from the dandelion seed puffs: each puff lets one go every
// 6 to 10 seconds; it rises a little and drifts away on the wind (three
// times as fast in a gust), then is gone. A fixed pool, no allocation.
function createSeedFlecks(puffs, cameraPosition) {
  const name = ART.v3.windBits;
  const { width, height, frames } = placeholderShape(name);
  const kinds = bitKinds(artMeta(), name);
  const seedFrame = kinds.includes('seed') ? kinds.indexOf('seed') : frames - 1;
  const texture = pixelTexture(artSource(name)).clone();
  texture.repeat.set(1 / frames, 1);
  texture.offset.set(seedFrame / frames, 0);
  const material = new THREE.MeshLambertMaterial({ map: texture, alphaTest: SPRITE_ALPHA_TEST });
  const mesh = new THREE.InstancedMesh(uprightPlaneGeometry(width, height), material, DANDELION_FLECK_POOL);
  mesh.frustumCulled = false;

  const puffHeight = placeholderShape(ART.v3.flower.dandelion).height * PX_WORLD * SPRITE_STRETCH_Y * PUFF_TOP;
  const random = effectRandom(MEADOW_SEED + 2);
  const releases = createPuffReleases(puffs.length, random);
  const x = new Float32Array(DANDELION_FLECK_POOL);
  const y = new Float32Array(DANDELION_FLECK_POOL);
  const z = new Float32Array(DANDELION_FLECK_POOL);
  const age = new Float32Array(DANDELION_FLECK_POOL).fill(Infinity); // Infinity: free
  const bob = new Float32Array(DANDELION_FLECK_POOL);
  const matrix = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const yaw = faceYaw({ x: 0, z: 0 }, cameraPosition);
  for (let i = 0; i < DANDELION_FLECK_POOL; i++) mesh.setMatrixAt(i, hidden);

  const release = (p) => {
    const puff = puffs[p];
    for (let i = 0; i < DANDELION_FLECK_POOL; i++) {
      if (age[i] !== Infinity) continue;
      x[i] = puff.x;
      y[i] = GROUND_Y + puffHeight;
      z[i] = puff.z;
      age[i] = 0;
      bob[i] = random() * Math.PI * 2;
      return;
    }
  };

  return {
    mesh,
    clear() {
      age.fill(Infinity);
      releases.clear();
      for (let i = 0; i < DANDELION_FLECK_POOL; i++) mesh.setMatrixAt(i, hidden);
      mesh.instanceMatrix.needsUpdate = true;
    },
    update(timeMs, dtMs, gust) {
      releases.step(timeMs, release);
      const dt = dtMs / 1000;
      const speed = fleckSpeed(gust);
      for (let i = 0; i < DANDELION_FLECK_POOL; i++) {
        if (age[i] === Infinity) continue;
        age[i] += dtMs;
        if (age[i] >= DANDELION_FLECK_MS) {
          age[i] = Infinity;
          mesh.setMatrixAt(i, hidden);
          continue;
        }
        x[i] += WIND_GROUND.x * speed * dt;
        z[i] += WIND_GROUND.z * speed * dt;
        y[i] += FLECK_RISE * dt;
        matrix.makeRotationY(yaw);
        matrix.setPosition(x[i], y[i] + FLECK_BOB * Math.sin(age[i] / 400 + bob[i]), z[i]);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
