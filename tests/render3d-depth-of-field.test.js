// The High depth of field, the camera's clip planes and the URL switches
// for the High-only effects (docs/art-direction-v3.md section 5). No
// browser: Three.js comes from vendor/ through a small resolve hook.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import * as THREE from '../vendor/three/build/three.module.js';
import {
  BOARD_SIZE, CELL_SIZE, CLOUD_LAYERS, DOF_BLUR_PER_UNIT, DOF_MAX_BLUR, DOF_SHARP_MARGIN, MEADOW_SEED, PX_WORLD,
  SPRITE_STRETCH_Y, SUN_RAY_DEPTH,
} from '../src/config.js';
import { placeholderShape } from '../src/render3d/art-assets.js';
import { createGameCamera, gameCamera } from '../src/render3d/camera.js';
import {
  blurRadius, clipPlanes, createDofState, CLIP_MARGIN, focusDistance, sharpBand, updateDofUniforms, viewDepth,
  viewDepthAt, visibleDepths,
} from '../src/render3d/depth-of-field.js';
import { CURB, FENCE_RAIL_HEIGHTS, fencePosts } from '../src/render3d/farm-layout.js';
import { CAMERA_POSE, FAR_EDGE_NDC_Y } from '../src/render3d/framing.js';
import { FAR_EDGE_Z, groundUnderNdc, TREE_ROW_Z } from '../src/render3d/horizon.js';
import { FAR_HILLS, planMeadow } from '../src/render3d/meadow.js';
import { SKY_ALPHA_CUTOFF } from '../src/render3d/sky.js';
import { SPRITE_ALPHA_TEST } from '../src/render3d/sprite-frames.js';
import {
  FX_ALL_ON, FX_SWITCHES, fxFeatures, parseFxSwitches, QUALITY_LEVELS,
} from '../src/render3d/quality.js';

const POSE = gameCamera(16 / 9);
const BAND = sharpBand(POSE);
const HALF = (BOARD_SIZE * CELL_SIZE) / 2;
const read = (file) => readFileSync(new URL(`../src/render3d/${file}`, import.meta.url), 'utf8');
const radiusAt = (x, y, z) => blurRadius(viewDepthAt(x, y, z, POSE), POSE);

// --- blurRadius: exactly 0 from 3 in front of the field to 3 behind it ---

test('the focus is the distance from the shared camera pose to the board centre', () => {
  const p = POSE.position;
  assert.equal(focusDistance(POSE), Math.hypot(p.x, p.y, p.z));
  // The pose is the one of framing.js, aim offset included.
  assert.ok(Math.abs(POSE.target.z + CAMERA_POSE.aimBehind) < 1e-12);
  assert.ok(Math.abs(Math.hypot(p.x - POSE.target.x, p.y - POSE.target.y, p.z - POSE.target.z) - CAMERA_POSE.distance) < 1e-9);
  assert.ok(BAND.focus > BAND.near && BAND.focus < BAND.far, 'the focus lies inside the sharp band');
  assert.equal(blurRadius(BAND.focus, POSE), 0);
});

test('the blur radius is 0 at the four field corners and the centre', () => {
  for (const x of [-HALF, HALF]) {
    for (const z of [-HALF, HALF]) {
      assert.equal(radiusAt(x, 0, z), 0, `corner ${x}, ${z}`);
      assert.equal(radiusAt(x, CURB.top, z), 0, `curb top at ${x}, ${z}`);
    }
  }
  assert.equal(radiusAt(0, 0, 0), 0, 'centre');
});

test('the blur radius is 0 over the whole band, 3 world units past the front and back edges', () => {
  assert.equal(BAND.near, viewDepthAt(0, 0, HALF + DOF_SHARP_MARGIN, POSE));
  assert.ok(BAND.far >= viewDepthAt(0, 0, -HALF - DOF_SHARP_MARGIN, POSE));
  for (let z = -HALF - DOF_SHARP_MARGIN; z <= HALF + DOF_SHARP_MARGIN + 1e-9; z += 0.25) {
    for (const x of [-20, -HALF, 0, HALF, 20]) assert.equal(radiusAt(x, 0, z), 0, `ground ${x}, ${z}`);
  }
  for (let depth = BAND.near; depth <= BAND.far; depth += 0.1) assert.equal(blurRadius(depth, POSE), 0);
});

test('the blur radius is 0 on the fence line and the back row of trees', () => {
  for (const post of fencePosts()) {
    for (const h of [0, ...FENCE_RAIL_HEIGHTS, 1]) assert.equal(radiusAt(post.x, h, post.z), 0, `fence ${post.x}, ${post.z}`);
  }
  const treeHeight = placeholderShape('trees').height * PX_WORLD * SPRITE_STRETCH_Y;
  for (const z of TREE_ROW_Z) {
    for (const h of [0, treeHeight / 2, treeHeight]) assert.equal(radiusAt(0, h, z), 0, `tree row ${z} at ${h}`);
  }
  for (const tree of planMeadow(MEADOW_SEED).trees.filter((t) => t.z < -10)) {
    assert.equal(radiusAt(tree.x, 0, tree.z), 0, 'a back-row trunk');
    assert.equal(radiusAt(tree.x, treeHeight, tree.z), 0, 'a back-row crown');
  }
});

test('outside the band the blur only grows gently, up to DOF_MAX_BLUR', () => {
  assert.ok(DOF_MAX_BLUR * 1080 <= 2, 'never more than 2 px at 1080 px tall');
  const justPast = blurRadius(BAND.far + 1, POSE);
  assert.ok(justPast > 0 && Math.abs(justPast - DOF_BLUR_PER_UNIT) < 1e-12);
  assert.ok(Math.abs(blurRadius(BAND.near - 2, POSE) - 2 * DOF_BLUR_PER_UNIT) < 1e-12);
  let last = 0;
  for (let depth = BAND.far; depth < 400; depth += 1) {
    const r = blurRadius(depth, POSE);
    assert.ok(r >= last && r <= DOF_MAX_BLUR);
    last = r;
  }
  assert.equal(blurRadius(1000, POSE), DOF_MAX_BLUR);
});

// --- The blur pass reads the live camera ---

const hook = `
const root = ${JSON.stringify(new URL('../', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'vendor/three/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: root + 'vendor/three/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

function liveCamera() {
  const camera = createGameCamera(THREE, 16 / 9, clipPlanes(POSE));
  camera.updateMatrixWorld();
  return camera;
}

const freshUniforms = () => Object.fromEntries(
  ['cameraNear', 'cameraFar', 'bandNear', 'bandFar', 'blurPerUnit', 'maxBlur', 'aspect'].map((name) => [name, { value: 0 }]),
);

test('updateDofUniforms works the band out from the live camera pose', () => {
  const camera = liveCamera();
  const uniforms = updateDofUniforms(freshUniforms(), camera, createDofState());
  const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);
  close(uniforms.bandNear.value, BAND.near, 'near edge of the band');
  close(uniforms.bandFar.value, BAND.far, 'far edge of the band');
  assert.equal(uniforms.cameraNear.value, camera.near);
  assert.equal(uniforms.cameraFar.value, camera.far);
  assert.equal(uniforms.blurPerUnit.value, DOF_BLUR_PER_UNIT);
  assert.equal(uniforms.maxBlur.value, DOF_MAX_BLUR);

  // Shake the camera and move its planes: the next frame follows.
  const state = createDofState();
  camera.position.y += 2;
  camera.position.z -= 1;
  camera.near = 7;
  camera.updateMatrixWorld();
  updateDofUniforms(uniforms, camera, state);
  const moved = { position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, target: { ...POSE.target } };
  moved.target.y += 2;
  moved.target.z -= 1;
  const band = sharpBand(moved);
  close(uniforms.bandNear.value, band.near, 'moved near edge');
  close(uniforms.bandFar.value, band.far, 'moved far edge');
  assert.notEqual(uniforms.bandNear.value, BAND.near);
  assert.equal(uniforms.cameraNear.value, 7);
});

test('the depth of field pass is given the live camera and reads it every frame', async () => {
  const { DepthOfFieldPass } = await import('../src/render3d/post-processing.js');
  const camera = liveCamera();
  const pass = new DepthOfFieldPass(camera);
  assert.equal(pass.camera, camera, 'no copy of the camera');
  const renderer = { setRenderTarget() {}, render() {} };
  const buffer = { texture: {}, depthTexture: {} };
  pass.render(renderer, {}, buffer);
  const { uniforms } = pass.material;
  assert.equal(uniforms.tDepth.value, buffer.depthTexture, 'the depth of the scene render itself');
  const before = uniforms.bandNear.value;
  camera.position.y += 3;
  camera.updateMatrixWorld();
  pass.render(renderer, {}, buffer);
  assert.notEqual(uniforms.bandNear.value, before);
  assert.equal(pass.material.depthWrite, false);

  const source = read('post-processing.js').replace(/^\s*\/\/.*$/gm, ''); // code only, not comments
  assert.ok(!/BokehPass|overrideMaterial|MeshDepthMaterial/.test(source), 'no separate depth render with one plain material');
  assert.match(read('world.js'), /createPostProcessing\(renderer, scene, camera\)/);
  assert.ok(!/camera\.clone\(\)/.test(source));
});

// --- Depth writers ---

// Every `new THREE.<kind>Material({ ... })` in src/render3d, with its options.
function materialLiterals() {
  const found = [];
  for (const file of readdirSync(new URL('../src/render3d/', import.meta.url))) {
    if (!file.endsWith('.js')) continue;
    const source = read(file);
    const pattern = /new THREE\.(\w*)Material\(/g;
    let match;
    while ((match = pattern.exec(source))) {
      let depth = 1;
      let i = pattern.lastIndex;
      for (; depth > 0 && i < source.length; i++) {
        if (source[i] === '(') depth++;
        else if (source[i] === ')') depth--;
      }
      found.push({ file, kind: match[1], options: source.slice(pattern.lastIndex, i - 1) });
    }
  }
  return found;
}

// Opaque surfaces with a texture but no see-through pixels: the field, the
// curb wood and the meadow ground. They write depth everywhere on purpose.
const OPAQUE_SURFACES = [
  (m) => m.file === 'farm-field.js' && /roughness/.test(m.options),
  (m) => m.file === 'farm-field.js' && /map: wood/.test(m.options),
  (m) => m.file === 'meadow-scene.js' && /BEHIND_FIELD/.test(m.options),
];

const ALPHA_TESTS = { SPRITE_ALPHA_TEST, SKY_ALPHA_CUTOFF };

test('every depth-writing sprite material has an alpha test above 0 or does not write depth', () => {
  assert.ok(SPRITE_ALPHA_TEST > 0 && SKY_ALPHA_CUTOFF > 0);
  const materials = materialLiterals();
  assert.ok(materials.length >= 15, 'found the materials');
  for (const m of materials) {
    const where = `${m.file}: ${m.kind}Material(${m.options.slice(0, 60).replace(/\s+/g, ' ')})`;
    const noDepth = /depthWrite: false/.test(m.options);
    if (/transparent: true/.test(m.options) || m.kind === 'Shader') {
      assert.ok(noDepth, `soft see-through material writes depth: ${where}`);
      continue;
    }
    if (noDepth || !/\bmap\b/.test(m.options) || OPAQUE_SURFACES.some((is) => is(m))) continue;
    const test = /alphaTest: ([\w.]+)/.exec(m.options);
    assert.ok(test, `sprite material writes depth without an alpha test: ${where}`);
    const value = ALPHA_TESTS[test[1]] ?? Number(test[1]);
    assert.ok(value > 0, `alpha test above 0: ${where}`);
  }
  // Materials made see-through after they are built stop writing depth too.
  for (const file of ['world-renderer.js', 'effects3d.js']) {
    const source = read(file);
    const transparent = source.match(/material\.transparent = true/g)?.length ?? 0;
    const noDepth = source.match(/material\.depthWrite = false/g)?.length ?? 0;
    assert.ok(noDepth >= transparent, file);
  }
});

test('the sprite, decal and soft effect materials, built for real', async () => {
  const { spriteMaterial } = await import('../src/render3d/sprites.js');
  const { decalMaterial } = await import('../src/render3d/world.js');
  const sprite = spriteMaterial(new THREE.Texture());
  assert.ok(sprite.depthWrite && sprite.alphaTest === SPRITE_ALPHA_TEST, 'a sprite writes depth only where it shows');
  const decal = decalMaterial({ width: 16, height: 16 });
  assert.ok(decal.transparent && !decal.depthWrite, 'decals write no depth');
  assert.ok(decal.polygonOffset && decal.polygonOffsetFactor < 0, 'decals lie on the field by polygon offset');
});

// --- Depth precision ---

test('the near and far planes hug what the camera shows with a 10 percent margin', () => {
  const { near, far } = clipPlanes(POSE);
  const bottom = groundUnderNdc(POSE, 0, -1);
  const things = [
    SUN_RAY_DEPTH, // the sun rays, the nearest thing
    viewDepthAt(bottom.x, 0, bottom.z, POSE), // the ground at the bottom of the screen
    viewDepthAt(0, 0, FAR_EDGE_Z, POSE), // the far edge of the meadow
    CLOUD_LAYERS.near.depth,
    CLOUD_LAYERS.far.depth,
  ];
  const camera = createGameCamera(THREE, 16 / 9);
  for (const hill of FAR_HILLS) {
    // Where the far edge's screen row meets the hill: its lowest visible point.
    const ray = new THREE.Vector3(0, FAR_EDGE_NDC_Y, 0.5).unproject(camera).sub(camera.position).normalize();
    const s = (hill.z - camera.position.z) / ray.z;
    const point = camera.position.clone().addScaledVector(ray, s);
    things.push(viewDepth(point, POSE));
  }
  const nearest = Math.min(...things);
  const farthest = Math.max(...things);
  assert.deepEqual(visibleDepths(POSE), { nearest, farthest: visibleDepths(POSE).farthest });
  assert.ok(Math.abs(visibleDepths(POSE).farthest - farthest) < 1e-6);
  assert.equal(CLIP_MARGIN, 0.1);
  assert.ok(Math.abs(near - nearest * 0.9) < 1e-9, `near ${near}`);
  assert.ok(Math.abs(far - farthest * 1.1) < 1e-6, `far ${far}`);
  for (const depth of things) assert.ok(depth > near && depth < far, `${depth} inside ${near} to ${far}`);
  assert.ok(far / near < 25, 'a tight range keeps depth precision');
});

test('the world camera uses those planes', () => {
  assert.match(read('world.js'), /createGameCamera\(THREE, WORLD_ASPECT, clipPlanes\(cameraSetup\)\)/);
  const camera = createGameCamera(THREE, 16 / 9, clipPlanes(POSE));
  assert.deepEqual({ near: camera.near, far: camera.far }, clipPlanes(POSE));
});

test('coplanar surfaces are layered by polygon offset, not by tiny heights', () => {
  assert.ok(!/DECAL_LIFT|PATH_LIFT|SHADOW_LIFT = 0\.0/.test(read('world.js') + read('farm-field.js') + read('sprites.js')));
  assert.match(read('meadow-scene.js'), /BEHIND_FIELD = \{ polygonOffset: true, polygonOffsetFactor: 1/);
  assert.match(read('sprites.js'), /ON_SURFACE = Object\.freeze\(\{ polygonOffset: true, polygonOffsetFactor: -1/);
  assert.match(read('farm-field.js'), /alphaTest: 0\.5, \.\.\.ON_SURFACE/, 'the path');
  assert.match(read('world.js'), /fog: false,\s+\.\.\.ON_SURFACE/, 'the decals');
});

// --- URL switches ---

test('parseFxSwitches reads ?fx=off and the six single switches', () => {
  assert.deepEqual(FX_SWITCHES, ['dof', 'bloom', 'wind', 'rays', 'shadows', 'ripples']);
  assert.deepEqual(parseFxSwitches(''), FX_ALL_ON);
  assert.deepEqual(parseFxSwitches(undefined), FX_ALL_ON);
  const allOff = parseFxSwitches('?fx=off');
  for (const value of Object.values(allOff)) assert.equal(value, false);
  for (const name of FX_SWITCHES) {
    assert.deepEqual(parseFxSwitches(`?${name}=off`), { ...FX_ALL_ON, [name]: false }, name);
  }
  assert.deepEqual(parseFxSwitches('?fx=off&dof=on'), { ...allOff, dof: true }, 'one back on');
  assert.deepEqual(parseFxSwitches('?dof=OFF&bloom=%20off%20'), { ...FX_ALL_ON, dof: false, bloom: false }, 'case and spaces');
  assert.deepEqual(parseFxSwitches(new URLSearchParams('quality=high&rays=off')), { ...FX_ALL_ON, rays: false });
});

test('unknown switch names and values are ignored', () => {
  assert.deepEqual(parseFxSwitches('?dof=0&bloom=no&wind=&fx=maybe&grade=off&sparkle=off&quality=low'), FX_ALL_ON);
  assert.ok(Object.isFrozen(parseFxSwitches('?fx=off')));
});

test('the switches apply only on High', () => {
  const allOff = parseFxSwitches('?fx=off');
  assert.equal(fxFeatures(QUALITY_LEVELS.medium, allOff), QUALITY_LEVELS.medium);
  assert.equal(fxFeatures(QUALITY_LEVELS.low, allOff), QUALITY_LEVELS.low);
  assert.equal(fxFeatures(QUALITY_LEVELS.high, FX_ALL_ON), QUALITY_LEVELS.high);
  assert.equal(fxFeatures(QUALITY_LEVELS.high), QUALITY_LEVELS.high);

  const high = fxFeatures(QUALITY_LEVELS.high, allOff);
  assert.deepEqual(high.postEffects, { bloom: false, depthOfField: false, warmGrade: false, vignette: false });
  assert.equal(high.wind, false);
  assert.equal(high.meadowFlowers, QUALITY_LEVELS.medium.meadowFlowers, 'no sway');
  assert.equal(high.shadows, QUALITY_LEVELS.medium.shadows, 'no long shadows');
  assert.equal(high.ground, QUALITY_LEVELS.medium.ground, 'no ripples');
  assert.equal(high.particleCap, QUALITY_LEVELS.high.particleCap, 'the rest stays High');
  assert.deepEqual(Object.keys(high), Object.keys(QUALITY_LEVELS.high), 'same columns');
  assert.ok(Object.isFrozen(high) && Object.isFrozen(high.postEffects));
  assert.equal(fxFeatures(QUALITY_LEVELS.high, parseFxSwitches('?fx=off')), high, 'built once');

  const one = (query) => fxFeatures(QUALITY_LEVELS.high, parseFxSwitches(query));
  assert.deepEqual(one('?dof=off').postEffects, { ...QUALITY_LEVELS.high.postEffects, depthOfField: false });
  assert.deepEqual(one('?bloom=off').postEffects, { ...QUALITY_LEVELS.high.postEffects, bloom: false });
  assert.equal(one('?shadows=off').shadows, 'blob');
  assert.equal(one('?ripples=off').ground, 'painted');
  assert.equal(one('?wind=off').wind, false);
  assert.equal(one('?rays=off'), one('?rays=off'));
  assert.deepEqual(one('?rays=off'), QUALITY_LEVELS.high, 'rays are not a column; the sky reads the switch');
  assert.match(read('world.js'), /buildBreezeHill\(scene, cameraPos, camera, \{ sunRays: fx\.rays \}\)/);
  assert.match(read('world.js'), /fxFeatures\(QUALITY_LEVELS\[next\], fx\)/);
});
