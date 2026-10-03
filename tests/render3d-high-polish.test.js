// Farmland v3 part 9 (docs/art-direction-v3.md sections 5, 7 and 10): the
// High polish (long sun shadows, cloud shadows, bloom on bright things
// only, the warm grade and vignette) and the performance rules (no
// allocations in the render loop, nothing rebuilt by a quality switch).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import * as THREE from '../vendor/three/build/three.module.js';
import {
  BLOOM_PETAL_GLOW, BLOOM_PETAL_LUMINANCE, BLOOM_SPARKLE_GLOW, BLOOM_THRESHOLD, CLOUD_LAYERS, CLOUD_SHADOW_TILE,
  CLOUD_SHADOW_TINT, PX_WORLD, SPRITE_STRETCH_Y, SUN_SHADOW_LENGTH, SUN_SHADOW_OPACITY,
} from '../src/config.js';
import { boardMarks, boardMarksInto, createBoardMarks } from '../src/render3d/board-marks.js';
import { QUALITY_LEVELS, QUALITY_ORDER } from '../src/render3d/quality.js';
import { vignetteMix, warmGrade } from '../src/render3d/screen-grade.js';
import { cloudShadowOffset, cloudShadowShade, SUN_SHADOW_GROUND, sunShadowCorners } from '../src/render3d/shadow-math.js';
import { WIND_GROUND } from '../src/render3d/wind.js';
import { O, X } from '../src/logic/board.js';
import { fakeCanvas, fakeRenderer, installFakeDocument } from './fake-browser.js';

const read = (file) => readFileSync(new URL(file.includes('/') ? `../src/${file}` : `../src/render3d/${file}`, import.meta.url), 'utf8');
const code = (file) => read(file).replace(/^\s*\/\/.*$/gm, ''); // code only, not comments
const close = (a, b, message, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${message}: ${a} vs ${b}`);
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLinear = (hex) => [0, 2, 4].map((i) => srgbToLinear(parseInt(hex.slice(i + 1, i + 3), 16) / 255));

const hook = `
const root = ${JSON.stringify(new URL('../', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'vendor/three/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: root + 'vendor/three/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

// --- Long sun shadows ---

test('sun shadows fall toward the lower right of the screen', () => {
  assert.ok(SUN_SHADOW_GROUND.x > 0, 'to the right');
  assert.ok(SUN_SHADOW_GROUND.z > 0, 'toward the camera, which is down the screen');
  close(Math.hypot(SUN_SHADOW_GROUND.x, SUN_SHADOW_GROUND.z), 1, 'a unit vector');
  assert.equal(SUN_SHADOW_OPACITY, 0.35);
  assert.equal(SUN_SHADOW_LENGTH, 0.9);
});

test('a sun shadow is the sheared silhouette, rooted under the sprite and 0.9 times its height long', () => {
  const [w, h, root] = [36, 40, 3]; // a plant frame, anchor (18, 36)
  const [tl, tr, bl, br] = sunShadowCorners(w, h, root);
  // Frame corners in PlaneGeometry order.
  assert.deepEqual([tl, tr, bl, br].map((c) => [c.u, c.v]), [[0, 1], [1, 1], [0, 0], [1, 0]]);
  // The full frame width, unsheared across.
  close(tr.x - tl.x, w * PX_WORLD, 'top width');
  close(br.x - bl.x, w * PX_WORLD, 'bottom width');
  close(tr.z, tl.z, 'top row level');
  // The root row lies on the ground point: interpolate to v = root / h.
  const t = root / h;
  close(bl.x + (tl.x - bl.x) * t, -(w * PX_WORLD) / 2, 'root left');
  close(bl.z + (tl.z - bl.z) * t, 0, 'root at the feet');
  // The top falls 0.9 times the height above the root, along the sun direction.
  const reach = (h - root) * PX_WORLD * SPRITE_STRETCH_Y * SUN_SHADOW_LENGTH;
  close(Math.hypot(tl.x + (w * PX_WORLD) / 2, tl.z), reach, 'length');
  close(tl.z / reach, SUN_SHADOW_GROUND.z, 'direction');
  // A bottom-centre sprite starts right at its feet.
  const flat = sunShadowCorners(16, 12);
  close(flat[2].z, 0, 'no root row');
});

test('sprites carry a sun shadow with their own frame; the level picks blob or sun, never both', async () => {
  const { sunShadowGeometry, sunShadowMaterial } = await import('../src/render3d/sprites.js');
  const map = new THREE.Texture();
  const material = sunShadowMaterial(map);
  assert.equal(material.map, map, 'the shadow reads the texture the sprite shows');
  assert.equal(material.depthWrite, false);
  assert.equal(material.opacity, SUN_SHADOW_OPACITY);
  assert.ok(material.polygonOffset && material.polygonOffsetFactor < 0, 'lies on the ground by polygon offset');
  assert.equal(sunShadowGeometry(36, 40, 3), sunShadowGeometry(36, 40, 3), 'shared geometry per frame size');
  const positions = sunShadowGeometry(36, 40, 3).attributes.position;
  for (let i = 0; i < positions.count; i++) assert.equal(positions.getY(i), 0, 'flat on the ground');
  const sprites = code('sprites.js');
  assert.match(sprites, /sunShadowMaterial\(this\.texture\)/, 'each sprite shadow uses the sprite\'s own texture (its frame)');
  assert.match(sprites, /this\.sunShadow\.visible = false;/, 'hidden until the level shows it');
  assert.match(code('effects3d.js'), /sprite\.setShadowScale\(factor\)/, 'a falling rock scales both shadows');

  assert.equal(QUALITY_LEVELS.high.shadows, 'sun');
  const world = code('world.js');
  assert.match(world, /blobShadows = features\.shadows === 'blob'/);
  assert.match(world, /sunShadows = features\.shadows === 'sun'/);
  assert.match(world, /renderer\.shadowMap\.enabled = false/, 'no shadow map render pass');
  assert.ok(!/castShadow/.test(world));
  const meadow = code('meadow-scene.js');
  assert.match(meadow, /scenerySunShadows\.visible = sun;/);
  assert.match(meadow, /flowerSunShadows\.visible = sun;/);
});

// --- Cloud shadows ---

test('a cloud shadow never takes more than about 25 percent of the light', () => {
  for (const m of [-1, 0, 0.25, 0.5, 0.75, 1, 2, NaN]) {
    const shade = cloudShadowShade(m);
    for (const c of shade) assert.ok(c >= 0.75 - 1e-12 && c <= 1, `mask ${m}: ${shade}`);
  }
  assert.deepEqual(cloudShadowShade(0), [1, 1, 1], 'open sky changes nothing');
  assert.deepEqual(cloudShadowShade(1), CLOUD_SHADOW_TINT);
  assert.ok(Math.min(...CLOUD_SHADOW_TINT) >= 0.75);
});

test('cloud shadows slide with the near cloud layer along the one wind, wrapped in one tile', () => {
  const a = cloudShadowOffset(1000, { x: 0, z: 0 });
  const b = cloudShadowOffset(2000, { x: 0, z: 0 });
  close(Math.hypot(b.x - a.x, b.z - a.z), CLOUD_LAYERS.near.speed, 'near layer speed per second');
  close((b.z - a.z) / (b.x - a.x), WIND_GROUND.z / WIND_GROUND.x, 'along the wind');
  assert.ok(b.x > a.x, 'toward the right');
  assert.ok(b.z > a.z, 'and toward the camera (depth): both axes of the wind');
  for (const t of [0, 1e5, 1e7, 3.6e9]) {
    const o = cloudShadowOffset(t, { x: 0, z: 0 });
    assert.ok(o.x >= 0 && o.x < CLOUD_SHADOW_TILE && o.z >= 0 && o.z < CLOUD_SHADOW_TILE, `wrapped at ${t}`);
  }
  const layer = code('cloud-shadows.js');
  assert.match(layer, /mesh\.visible = features\.shadows === 'sun'/, 'High only');
  assert.match(layer, /blendSrc: THREE\.DstColorFactor/, 'a multiply layer');
  assert.match(layer, /depthWrite: false/);
});

// --- Bloom, grade and vignette ---

test('bloom only catches what glows: the lit scene and the sky stay under the threshold', () => {
  assert.ok(BLOOM_THRESHOLD >= 1, 'above the brightest lit white and sky');
  assert.ok(luminance(hexLinear('#f4f0d8')) < BLOOM_THRESHOLD, 'the sky at the horizon');
  // Sparkles, gold for X and pink for O, glow; so do white and pale petals.
  for (const hex of ['#ffd84a', '#ff9cc8']) {
    assert.ok(luminance(hexLinear(hex)) * BLOOM_SPARKLE_GLOW > BLOOM_THRESHOLD, `sparkle ${hex}`);
  }
  assert.ok(luminance([1, 1, 1]) * BLOOM_PETAL_GLOW > BLOOM_THRESHOLD, 'a white petal');
  assert.ok(BLOOM_PETAL_LUMINANCE >= 0.5, 'only bright petals are lifted');
  const post = code('post-processing.js');
  assert.match(post, /GLOW\.uSparkleGlow\.value = postEffects\.bloom \? BLOOM_SPARKLE_GLOW : 1/, 'no glow lift without bloom');
  assert.match(post, /GLOW\.uPetalGlow\.value = postEffects\.bloom \? BLOOM_PETAL_GLOW : 1/);
});

test('the warm grade warms and the vignette is light', () => {
  const grey = warmGrade([0.5, 0.5, 0.5]);
  assert.ok(grey[0] > grey[2], 'red over blue');
  assert.ok(grey.every((c) => c > 0.4 && c < 0.6), 'a gentle grade');
  assert.equal(vignetteMix(0.5, 0.5), 0, 'the centre is untouched');
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const corner = vignetteMix(u, v);
    assert.ok(corner > 0 && corner <= 0.2, `corner ${u}, ${v}: ${corner}`);
  }
});

test('Low and Medium have no post effects at all, so no blur', () => {
  for (const level of ['low', 'medium']) {
    assert.deepEqual(QUALITY_LEVELS[level].postEffects, { bloom: false, depthOfField: false, warmGrade: false, vignette: false });
  }
  assert.deepEqual(QUALITY_LEVELS.high.postEffects, { bloom: true, depthOfField: true, warmGrade: true, vignette: true });
});

// --- Performance rules ---

test('boardMarksInto reuses one result: the same list and objects every frame', () => {
  const view = {
    state: { winLine: [{ x: 1, y: 1 }, { x: 2, y: 2 }], currentPlayer: 'X' },
    hover: { x: 4, y: 5 },
    preview: { type: 'dash', from: { x: 3, y: 3 }, to: { x: 6, y: 6 } },
  };
  const out = createBoardMarks();
  assert.equal(boardMarksInto(view, out), out);
  const list = out.decals;
  const objects = [...out.decals];
  const ghost = out.ghost;
  assert.equal(out.count, 4);
  boardMarksInto(view, out);
  assert.equal(out.decals, list, 'the same array');
  assert.equal(out.decals.length, objects.length, 'it did not grow');
  out.decals.forEach((d, i) => assert.equal(d, objects[i], 'the same decal objects'));
  assert.equal(out.ghost, ghost, 'the same ghost object');
  // The same marks as a fresh call.
  const fresh = boardMarks(view);
  const label = (d) => `${d.kind}@${d.x},${d.y}`;
  assert.deepEqual(out.decals.slice(0, out.count).map(label), fresh.decals.map(label));
  assert.deepEqual({ ...out.ghost }, fresh.ghost);
  // Fewer marks: the count drops, the list keeps its objects (it never shrinks).
  boardMarksInto({ state: { winLine: null, currentPlayer: 'O' }, hover: null, preview: null }, out);
  assert.equal(out.count, 0);
  assert.equal(out.decals.length, objects.length);
  assert.equal(out.ghost, null);
  assert.match(code('world-renderer.js'), /boardMarksInto\(view, marks\)/, 'the renderer reuses one result');
});

test('a quality switch builds nothing new: every pass and shadow is made once and only toggled', () => {
  const post = code('post-processing.js');
  const setEffects = post.slice(post.indexOf('setEffects('), post.indexOf('resize,'));
  assert.ok(!/new /.test(setEffects), 'setEffects only switches passes');
  for (const file of ['meadow-scene.js', 'cloud-shadows.js', 'sky-scene.js']) {
    const source = code(file);
    const at = source.indexOf('setFeatures(features) {');
    assert.ok(at > 0, file);
    let depth = 0;
    let end = source.indexOf('{', at);
    for (; end < source.length; end++) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}' && --depth === 0) break;
    }
    assert.ok(!/new THREE|\.dispose\(|pixelTexture\(/.test(source.slice(at, end)), `${file} setFeatures only toggles`);
  }
});

// --- The real scene under Node (fake-browser.js: a canvas that draws
// nothing and a WebGL renderer stand-in) ---

test('the cloud shadow layer itself moves in x and in depth (z) over time, on High only', async () => {
  installFakeDocument();
  const { createCloudShadows } = await import('../src/render3d/cloud-shadows.js');
  const layer = createCloudShadows(new THREE.Scene());
  const offset = layer.mesh.material.uniforms.uOffset.value; // ground (x, z) as vec2 (x, y)

  layer.setFeatures({ shadows: 'blob', backgroundMotion: true }); // Medium
  layer.update(5000);
  assert.equal(layer.mesh.visible, false, 'no cloud shadows below High');
  assert.deepEqual([offset.x, offset.y], [0, 0]);

  layer.setFeatures({ shadows: 'sun', backgroundMotion: true }); // High
  assert.equal(layer.mesh.visible, true);
  layer.update(1000);
  const x1 = offset.x;
  const z1 = offset.y;
  layer.update(3000);
  const dx = offset.x - x1;
  const dz = offset.y - z1;
  assert.ok(dx > 0, `the layer moves in x: ${dx}`);
  assert.ok(dz > 0, `the layer moves in depth (z): ${dz}`);
  close(dz / dx, WIND_GROUND.z / WIND_GROUND.x, 'both along the one wind');
  close(Math.hypot(dx, dz), 2 * CLOUD_LAYERS.near.speed, 'at the near cloud layer speed', 1e-6);
  // The shader reads the ground's world z as the second offset axis.
  assert.match(code('cloud-shadows.js'), /vGround = \(modelMatrix \* vec4\(position, 1\.0\)\)\.xz;/);
  assert.match(code('cloud-shadows.js'), /\(vGround - uOffset\) \/ uTile/);
});

// Builds the game renderer on the stand-ins, with a game of a few moves.
async function buildGame(quality) {
  installFakeDocument();
  const { createWorldRenderer } = await import('../src/render3d/world-renderer.js');
  const { createLocalGame } = await import('../src/ui/local-game.js');
  const gl = fakeRenderer();
  const renderer = createWorldRenderer(fakeCanvas(), { storage: null, quality, createRenderer: () => gl });
  const game = createLocalGame();
  const ctx = fakeCanvas().getContext('2d');
  let time = 1000;
  const frame = (hover = null) => {
    time += 16;
    game.setHover(hover);
    renderer.drawGameScreen(ctx, { ...game.getView(), time });
  };
  for (const cell of [{ x: 7, y: 7 }, { x: 8, y: 8 }, { x: 7, y: 8 }, { x: 9, y: 9 }]) {
    assert.ok(game.click(cell));
    renderer.trigger(game.takeEvents(), time);
    for (let i = 0; i < 10; i++) frame();
  }
  return { gl, renderer, game, frame };
}

// A probe of the Three.js id counters: every texture (render targets
// included), material and geometry made takes the next id, so the
// difference between two probes, less the probe's own, is how many were made.
function madeSince(before) {
  const now = { texture: new THREE.Texture().id, material: new THREE.Material().id, geometry: new THREE.BufferGeometry().id };
  if (!before) return now;
  return { texture: now.texture - before.texture - 1, material: now.material - before.material - 1, geometry: now.geometry - before.geometry - 1 };
}

// Every geometry, material and texture the scene uses now.
function gpuResources(scene) {
  const found = new Set();
  const addMaterial = (material) => {
    found.add(material);
    for (const value of Object.values(material)) if (value?.isTexture) found.add(value);
    for (const uniform of Object.values(material.uniforms ?? {})) if (uniform?.value?.isTexture) found.add(uniform.value);
  };
  scene.traverse((object) => {
    if (object.geometry) found.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach(addMaterial);
    else if (object.material) addMaterial(object.material);
  });
  if (scene.background?.isTexture) found.add(scene.background);
  return found;
}

test('switching quality at runtime keeps the game and makes, replaces or leaks no GPU resource', async () => {
  const disposed = new Set();
  const restore = [];
  for (const Kind of [THREE.Texture, THREE.Material, THREE.BufferGeometry, THREE.RenderTarget]) {
    const dispose = Kind.prototype.dispose;
    restore.push(() => { Kind.prototype.dispose = dispose; });
    Kind.prototype.dispose = function trackedDispose() {
      disposed.add(this);
      return dispose.call(this);
    };
  }
  try {
    const { gl, renderer, game, frame } = await buildGame('low');
    // Each level once first: a texture made the first time a level shows
    // (the field texture of each level) is kept for the next time.
    for (const level of [...QUALITY_ORDER, 'high']) {
      renderer.setQuality(level);
      frame({ x: 3, y: 3 });
    }
    const stateBefore = JSON.stringify(game.getState());
    const inUse = gpuResources(gl.scene);
    const probe = madeSince();

    for (let round = 0; round < 10; round++) {
      for (const level of QUALITY_ORDER) {
        renderer.setQuality(level);
        assert.equal(renderer.quality, level);
        frame({ x: round % 15, y: 4 });
      }
      renderer.cycleQuality(); // the Q key
      frame();
    }
    renderer.setQuality('high');
    frame({ x: 3, y: 3 });

    assert.deepEqual(madeSince(probe), { texture: 0, material: 0, geometry: 0 }, 'a quality switch makes no texture, render target, material or geometry');
    const nowInUse = gpuResources(gl.scene);
    for (const resource of nowInUse) {
      assert.ok(inUse.has(resource), `${resource.type ?? resource.constructor.name} is new after the switches`);
      assert.ok(!disposed.has(resource), `${resource.type ?? resource.constructor.name} is disposed but still in use`);
    }
    for (const resource of inUse) {
      // Anything a switch replaced must have been disposed (none is replaced).
      if (!nowInUse.has(resource)) assert.ok(disposed.has(resource), `${resource.type} was replaced without dispose()`);
    }
    assert.equal(JSON.stringify(game.getState()), stateBefore, 'the game goes on as it was');
    assert.equal(game.getState().board[7][7], X);
  } finally {
    for (const undo of restore) undo();
  }
});

test('the render loop makes no Three.js object at any level once its pools are warm', async () => {
  const { renderer, game, frame } = await buildGame('high');
  // A Tornado Zone preview and a moving hover, so the decal pools are used.
  for (const level of QUALITY_ORDER) {
    renderer.setQuality(level);
    for (let i = 0; i < 40; i++) frame({ x: i % 15, y: (i * 7) % 15 });
  }
  for (const level of QUALITY_ORDER) {
    renderer.setQuality(level);
    for (let i = 0; i < 5; i++) frame({ x: i, y: i });
    const probe = madeSince();
    for (let i = 0; i < 200; i++) frame({ x: i % 15, y: (i * 7) % 15 });
    assert.deepEqual(madeSince(probe), { texture: 0, material: 0, geometry: 0 }, `${level}: 200 frames`);
  }
  assert.equal(game.getState().board[9][9], O);
});

// The no allocation rule, by a source check of a call graph walk. The walk
// starts at the render loop (the `frame` functions of src/main.js) and
// follows every call by name into the functions of src/main.js and
// src/render3d (lab.js, a separate page, aside). A name defined more than
// once is followed into every definition, so the walk finds more than
// runs, never less. Every function it reaches must have parameters and a
// body without anything that makes a new object, array, string or closure:
// `new`, array or object literals (default parameters included), template
// literals, string concatenation, arrow functions or function expressions,
// spread, for...of (an iterator), or array and object helpers that return
// new ones. NOT_EACH_FRAME names the only functions it may not enter, each
// with the reason it does not run on an ordinary frame. Three.js's own
// renderer and EffectComposer are not ours to check; the Three.js test above
// shows the warm loop makes no textures, materials or geometries.
//
// Outside the 3D frame path, and so not walked: the game view models the
// loop reads (game.getView and getOutcome in src/ui and the room in src/net,
// which the rules keep out of rendering work; listed under Known
// allocations in docs/art-direction-v3.md), and hudViewModel and hud.render,
// which main.js's showHud calls only when something on the HUD changed.
// takeEvents and the other src/ui getters the loop calls are checked below
// (FRAME_PATH_ELSEWHERE).
// Every function of src/main.js and src/render3d the walk reaches, by file
// and name: the 3D frame path. The walk must reach exactly these, so a new
// function on the frame path has to be added here (and is then checked).
const FRAME_PATH = {
  'main.js': ['frame', 'frameViewOf', 'showEvents', 'showHud'],
  'render3d/art.js': ['artMeta'],
  'render3d/board-marks.js': ['addDecal', 'boardMarksInto', 'lastMoveOpacity', 'setGhost', 'winPulseOpacity'],
  'render3d/breeze-hill.js': ['update'],
  'render3d/character-poses.js': ['characterFrame', 'glowPulse', 'poseAtInto', 'stepGlow'],
  'render3d/characters3d.js': ['frameFor', 'setActive', 'update'],
  'render3d/cloud-shadows.js': ['update'],
  'render3d/depth-of-field.js': ['focusDistance', 'livePoseInto', 'set', 'sharpBandInto', 'updateDofUniforms',
    'viewDepthAt'],
  'render3d/effect-plans.js': ['arcHeight', 'clamp01', 'convertPose', 'convertWiltMs', 'crumblePose',
    'dashCurveInto', 'dashFoldMs', 'dashPose', 'reverseGrowthInto', 'reverseGrowthMs', 'rockFallPose', 'shakeLeft',
    'shakeOffset3d', 'shakeStrength', 'snapToStep', 'sparkPathInto', 'throwPose', 'worldUnitsPerPixel'],
  'render3d/effects3d.js': ['bendAt', 'bloomSparkles', 'crumbs', 'drawBanner', 'end', 'endTimeline', 'hide', 'holds',
    'markFade', 'moveAlong', 'openSparkles', 'petalGust', 'petalTrail', 'release', 'setShadow', 'show', 'soilPixels',
    'soilPuff', 'sparkTrail', 'startShake', 'stepTimeline', 'sync', 'update'],
  'render3d/fps.js': ['fps', 'lowest', 'tick'],
  'render3d/frame-gap.js': ['tick'],
  'render3d/growth.js': ['dropOffsetPx', 'enteredStage', 'growthStageInto', 'openPopScale', 'plantPoseInto'],
  'render3d/meadow-scene.js': ['clear', 'release', 'setRipple', 'update'],
  'render3d/particle-pool.js': ['alphaAt', 'clear', 'copy', 'emit', 'scaledCount', 'sizeAt', 'spawnFall',
    'spawnSpiral', 'step', 'take'],
  'render3d/petals.js': ['fieldFade', 'petalAt', 'smoothstep', 'trailAt'],
  'render3d/picking.js': ['cellToWorldInto'],
  'render3d/post-processing.js': ['render', 'resize'],
  'render3d/quality.js': ['blursMenus', 'cappedPixelRatio', 'clear', 'dropOldest', 'lowerQuality', 'particleScale',
    'plainSlides', 'tick'],
  'render3d/seeded-random.js': ['fill', 'random', 'step'],
  'render3d/shadow-math.js': ['cloudShadowOffset'],
  'render3d/sky-scene.js': ['place', 'placeDrifting', 'update', 'write'],
  'render3d/sky.js': ['skyDrift', 'sunRayAlpha', 'wrapAround'],
  'render3d/sprite-frames.js': ['anchorForward', 'faceYaw', 'frameAt'],
  'render3d/sprites.js': ['setBend', 'setFrame', 'setShadowScale', 'update'],
  'render3d/view-size.js': ['sameViewSize', 'viewSizeInto'],
  'render3d/wind.js': ['bendTowardPx', 'clear', 'fleckSpeed', 'gap', 'gustEnvelope', 'nextReleaseMs',
    'plantSwayAmplitudePx', 'step', 'strength', 'swayAmplitudePx', 'swayLeanSide', 'swayPhase'],
  'render3d/world-renderer.js': ['drawGameScreen', 'drawMenuScreen', 'drawQuality', 'features', 'hide', 'look',
    'pieceKind', 'quality', 'rest', 'settle', 'show', 'sync'],
  'render3d/world.js': ['addSprite', 'autoStepped', 'drawingHeight', 'features', 'fps', 'fpsLowest', 'placeOnCell',
    'quality', 'render', 'resize', 'setCameraShake', 'setHoveredCell', 'showShadow', 'zonePieceGeometry'],
};
const FRAME_ROOTS = ['frame'];
const NOT_EACH_FRAME = {
  // Only on a frame with game events (`* name` is every function of that
  // name): the renderer's trigger and catchUp return at once on an empty
  // list, and every other trigger and catchUp is called only from them.
  '* trigger': 'only when events arrive',
  '* catchUp': 'only on the first frame after the page was hidden, with events',
  // Only when the level changes (the automatic step down after slow frames).
  'render3d/world.js applyQuality': 'only when the quality level changes',
  // Pools and caches grow the first time they need more, then are reused.
  'render3d/board-marks.js newDecal': 'a decal record pool that grows on a miss (??)',
  'render3d/world-renderer.js plantLook': 'built once per player on a miss (??)',
  'render3d/world-renderer.js qualityText': 'one string per level and FPS value, kept',
  'render3d/world-renderer.js lowestText': 'one string per lowest FPS value, kept',
  'main.js roomHint': 'only when the room or seat changes',
  'main.js forgetGame': 'only when a game starts or is left (resets every effect)',
  'render3d/world.js createPieceSprite': 'a piece sprite pool that grows on a miss (pop() ??)',
  'render3d/world.js createCellDecal': 'a decal mesh pool that grows on a miss',
  'render3d/world.js newZonePiece': 'one geometry per zone piece, built on a miss (??) and kept',
  // Names that only match a built-in or another module's function.
  'render3d/quality.js indexOf': 'the call is Array.prototype.indexOf',
  'render3d/v3-meta.js stageStartMs': 'a field validator of the same name, not a frame call',
  'render3d/meadow.js take': 'the call is particle-pool.js take (a scenery builder of the same name)',
};
// Outside src/main.js and src/render3d: [file, [enclosing function, header]
// or header]; only inside that function when one is given.
const FRAME_PATH_ELSEWHERE = [
  ['render/effects.js', ['export function createBanners(', 'draw(']],
  ['render/effects.js', ['export function createBanners(', 'const prune = (']],
  ['render/game-renderer.js', 'export function drawText('],
  ['logic/game.js', 'export function isGameOver('],
  // The game state getters main.js's frame calls on the app and the game.
  ['ui/app.js', ['export function createApp(', 'getScreen(']],
  ['ui/app.js', ['export function createApp(', 'getGame(']],
  ['ui/local-game.js', ['export function createLocalGame(', 'getTargeting(']],
  ['ui/local-game.js', ['export function createLocalGame(', 'takeEvents(']],
  ['ui/online-game.js', ['export function createOnlineGame(', 'getTargeting(']],
  ['ui/online-game.js', ['export function createOnlineGame(', 'takeEvents(']],
];

const ALLOCATIONS = [
  [/\bnew\s+[A-Za-z_$]/, 'new'],
  [/=>/, 'an arrow function'],
  [/\bfunction\b/, 'a function expression'],
  [/`/, 'a template literal'],
  [/(^|[=(,:?!&|]|\breturn)\s*\[/m, 'an array literal'],
  [/(^|[=(,:?!&|]|\breturn)\s*\{/m, 'an object literal'],
  [/\.\.\./, 'spread'],
  [/\bfor\s*\([^;)]*\bof\b/, 'for...of'],
  [/['"]\s*\+|\+\s*['"]/, 'string concatenation'],
  [/\.(map|filter|slice|splice|concat|flat|flatMap|reduce|forEach|split|join|bind|entries|keys|values|from|assign|toFixed|toString)\(/, 'a helper that makes a new object'],
];

const PARAMETER_SAFE = new Set(['an array literal', 'an object literal']);

// The source of `file` without comments and with string contents emptied.
function codeOnly(file) {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

// The parameters and body of the function whose parameter list starts at
// `i` (just past its `(`), or null if the parentheses are a call.
function functionFrom(source, i) {
  let depth = 1;
  const paramsStart = i;
  while (depth > 0 && i < source.length) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') depth--;
    i++;
  }
  const params = source.slice(paramsStart, i - 1);
  const arrow = source.slice(i).match(/^\s*(=>)?\s*/);
  let j = i + arrow[0].length;
  if (!arrow[1] && source[j] !== '{') return null;
  if (source[j] !== '{') return { params, body: source.slice(j, source.indexOf(';', j)) }; // an arrow's expression
  const start = j;
  depth = 0;
  do {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') depth--;
    j++;
  } while (depth > 0);
  return { params, body: source.slice(start + 1, j - 1) };
}

// The parameters and body of every function in `source` whose header (a
// line starting with `header`) matches.
function functionsAt(source, header) {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = [];
  for (const match of source.matchAll(new RegExp(`^[ \\t]*${escaped}`, 'gm'))) {
    const fn = functionFrom(source, match.index + match[0].length);
    if (fn) found.push(fn);
  }
  return found;
}

// Every named function of `file`: function declarations, methods and
// getters, `const name = (...) =>`, `obj.name = (...) =>` and `name: (...) =>`.
const DEFINITION = new RegExp([
  String.raw`^[ \t]*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(`,
  String.raw`^[ \t]*get\s+([A-Za-z_$][\w$]*)\s*\(`,
  String.raw`^[ \t]*([A-Za-z_$][\w$]*)\s*\(`,
  String.raw`^[ \t]*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\(`,
  String.raw`^[ \t]*[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)\s*=\s*\(`,
  String.raw`^[ \t]*([A-Za-z_$][\w$]*):\s*\(`,
].join('|'), 'gm');
const NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'super', 'constructor']);

function definitions(file) {
  const source = codeOnly(file);
  const found = [];
  for (const m of source.matchAll(DEFINITION)) {
    const name = m.slice(1).find((g) => g !== undefined);
    if (NOT_A_NAME.has(name)) continue;
    const fn = functionFrom(source, m.index + m[0].length);
    if (fn) found.push({ file, name, getter: m[2] !== undefined, ...fn });
  }
  return found;
}

// The functions the render loop reaches, by name, from FRAME_ROOTS.
function framePath() {
  const files = [
    './main.js',
    ...readdirSync(new URL('../src/render3d/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'lab.js'),
  ];
  const byName = new Map();
  for (const file of files) {
    for (const fn of definitions(file)) {
      fn.key = `${file.includes('/') ? file.replace('./', '') : `render3d/${file}`} ${fn.name}`;
      if (!byName.has(fn.name)) byName.set(fn.name, []);
      byName.get(fn.name).push(fn);
    }
  }
  const getters = new Set();
  for (const [name, fns] of byName) if (fns.some((fn) => fn.getter)) getters.add(name);
  const reached = [];
  const skipped = new Set();
  const seen = new Set();
  const queue = [...FRAME_ROOTS];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const fn of byName.get(name) ?? []) {
      const skip = [fn.key, `* ${fn.name}`].find((key) => key in NOT_EACH_FRAME);
      if (skip) {
        skipped.add(skip);
        continue;
      }
      reached.push(fn);
      for (const call of fn.body.matchAll(/([A-Za-z_$][\w$]*)\s*(?:\?\.)?\(/g)) queue.push(call[1]); // f() and f?.()
      for (const read of fn.body.matchAll(/\.([A-Za-z_$][\w$]*)\b/g)) if (getters.has(read[1])) queue.push(read[1]);
    }
  }
  return { reached, skipped };
}

function assertAllocatesNothing(where, { params, body }) {
  // A destructuring pattern in the parameters makes nothing; a literal
  // default value does.
  const defaultLiteral = params.match(/=\s*[{[]/);
  assert.ok(!defaultLiteral, `${where}: a literal default parameter in (${params})`);
  for (const [pattern, what] of ALLOCATIONS) {
    const hit = body.match(pattern) ?? (PARAMETER_SAFE.has(what) ? null : params.match(pattern));
    assert.ok(!hit, `${where}: ${what} near "${hit && hit.input.slice(Math.max(0, hit.index - 40), hit.index + 40)}"`);
  }
}

test('the 3D frame path allocates nothing: a source check of every function the render loop reaches', () => {
  const { reached, skipped } = framePath();
  for (const fn of reached) assertAllocatesNothing(fn.key, fn);
  for (const [file, entry] of FRAME_PATH_ELSEWHERE) {
    const source = codeOnly(file);
    const [within, header] = Array.isArray(entry) ? entry : [null, entry];
    const from = within === null ? 0 : source.indexOf(within);
    const scope = within === null ? source : source.slice(from, source.indexOf('\n}\n', from));
    const functions = functionsAt(scope, header);
    assert.ok(functions.length > 0, `${file}: no function starts with "${header}"`);
    for (const fn of functions) assertAllocatesNothing(`${file} ${header}...`, fn);
  }

  // The walk reaches exactly the listed frame path, and every exception is still used.
  const keys = new Set(reached.map((fn) => fn.key));
  const listed = new Set(Object.entries(FRAME_PATH).flatMap(([file, names]) => names.map((name) => `${file} ${name}`)));
  for (const key of listed) assert.ok(keys.has(key), `the walk did not reach ${key}; drop it from FRAME_PATH`);
  for (const key of keys) assert.ok(listed.has(key), `the walk reached ${key}: add it to FRAME_PATH`);
  for (const key of Object.keys(NOT_EACH_FRAME)) assert.ok(skipped.has(key), `${key} is never reached; drop it`);
  assert.ok(reached.length >= 150, `checked ${reached.length} functions`);
});

test('the source check finds what it should', () => {
  const caught = (code) => ALLOCATIONS.some(([pattern]) => pattern.test(code));
  for (const bad of [
    'const a = new THREE.Vector3();', 'return { x, z };', 'f({ size: 48 });', 'const list = [];', 'x = `FPS ${fps}`;',
    'for (const s of sprites) s.update();', 'const all = Object.values(parts);', 'list.map((d) => d.x);',
    "text = 'FPS ' + fps;", 'const copy = { ...ghost };', 'opts = {}',
  ]) assert.ok(caught(bad), bad);
  for (const fine of [
    'out.x = (x - offset) * size;', 'if (a) {\n b();\n}', 'for (let i = 0; i < n; i++) list[i].update(now);',
    'const { x, z } = pose;', 'return out;', 'mesh.position.set(x, y, z);', 'switch (k) {\n case 1:\n break;\n}',
  ]) assert.ok(!caught(fine), fine);
});

// --- The FPS counter for the owner's measurement (?fps=1) ---

test('?fps=1 turns on the lowest FPS reading; the meter keeps the lowest per level', async () => {
  const { createFpsMeter, parseFpsSwitch } = await import('../src/render3d/fps.js');
  assert.equal(parseFpsSwitch('?fps=1'), true);
  assert.equal(parseFpsSwitch('?quality=high&fps=1'), true);
  assert.equal(parseFpsSwitch('?fps=on'), true);
  assert.equal(parseFpsSwitch('?fps=0'), false);
  assert.equal(parseFpsSwitch(''), false);
  assert.equal(parseFpsSwitch(undefined), false);

  const meter = createFpsMeter(500);
  assert.equal(meter.lowest, Infinity, 'no reading yet');
  let t = 0;
  meter.tick(t);
  for (let i = 0; i < 120; i++) meter.tick((t += 1000 / 60)); // 2 seconds at 60
  for (let i = 0; i < 60; i++) meter.tick((t += 1000 / 30)); // 2 seconds at 30
  for (let i = 0; i < 120; i++) meter.tick((t += 1000 / 60)); // 2 seconds at 60
  assert.ok(Math.abs(meter.fps - 60) < 1.5, `typical ${meter.fps}`);
  assert.ok(Math.abs(meter.lowest - 30) < 1.5, `lowest ${meter.lowest}`);
  meter.resetLowest();
  assert.equal(meter.lowest, Infinity);
});

test('a quality change starts the lowest FPS reading over without the old level\'s frames', async () => {
  const { createFpsMeter } = await import('../src/render3d/fps.js');
  const meter = createFpsMeter(500);
  let t = 0;
  meter.tick(t);
  for (let i = 0; i < 60; i++) meter.tick((t += 1000 / 60)); // the old level, a second at 60
  for (let i = 0; i < 6; i++) meter.tick((t += 1000 / 20)); // then 300 ms at 20, mid window
  meter.resetLowest(); // the switch
  meter.tick((t += 120)); // the switch frame: rebuilt parts, new shaders
  for (let i = 0; i < 3; i++) meter.tick((t += 1000 / 60));
  meter.tick((t += 150)); // a warm-up hitch in the first window
  for (let i = 0; i < 300; i++) meter.tick((t += 1000 / 60)); // the new level runs at 60
  assert.ok(Math.abs(meter.lowest - 60) < 1.5, `lowest ${meter.lowest}: no 20 FPS frame of the old level, no warm-up`);
  for (let i = 0; i < 80; i++) meter.tick((t += 1000 / 40)); // a real slow spell later on counts
  for (let i = 0; i < 60; i++) meter.tick((t += 1000 / 60));
  assert.ok(Math.abs(meter.lowest - 40) < 1.5, `lowest ${meter.lowest}`);
});

test('the world starts the lowest FPS reading over on every quality change', () => {
  const source = code('world.js');
  const apply = source.slice(source.indexOf('function applyQuality('), source.indexOf('applyQuality(startLevel'));
  assert.match(apply, /fpsMeter\.resetLowest\(\)/);
});

test('the FPS counter shows on every level, with the lowest reading under ?fps=1', async () => {
  installFakeDocument();
  const { createWorldRenderer } = await import('../src/render3d/world-renderer.js');
  for (const showFps of [false, true]) {
    const renderer = createWorldRenderer(fakeCanvas(), { storage: null, quality: 'low', showFps, createRenderer: () => fakeRenderer() });
    const ctx = fakeCanvas().getContext('2d');
    const texts = [];
    ctx.fillText = (text) => texts.push(text);
    let time = 0;
    for (const level of QUALITY_ORDER) {
      renderer.setQuality(level);
      // two 500 ms windows: the first after a switch is a warm-up for the lowest reading
      for (let i = 0; i < 120; i++) renderer.drawMenuScreen(ctx, (time += 16));
      texts.length = 0;
      renderer.drawMenuScreen(ctx, (time += 16));
      const line = texts.find((text) => text.startsWith('Quality '));
      assert.match(line, new RegExp(`^Quality ${level} \\[Q\\]  FPS \\d+$`), `${level}: ${line}`);
      assert.ok(Number(line.split('FPS ')[1]) > 0, 'a reading');
      const lowest = texts.find((text) => text.startsWith('Lowest FPS'));
      if (showFps) assert.match(lowest, /^Lowest FPS \d+$/, `${level}: ${lowest}`);
      else assert.equal(lowest, undefined, 'only with ?fps=1');
    }
  }
});
