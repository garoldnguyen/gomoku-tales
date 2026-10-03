// The sky and the wind over the farm (docs/art-direction-v3.md section 7),
// drawn from the pure plans of sky.js and petals.js. Per quality row
// (src/render3d/quality.js):
//   sky   'gradient'         the plain gradient only
//         'still-clouds'     plus 4 still painted clouds from clouds.png
//         'drifting-clouds'  plus 8 clouds in two layers drifting straight to
//                            the right on screen (they are high above the
//                            ground) and wrapping around sideways, 6 soft
//                            wisps drifting with them and 3 breathing sun
//                            rays from the upper left
//   wind  petals, leaves and seed flecks from wind-bits in three lanes,
//         each with a 3 ghost trail
//   backgroundMotion  whether the clouds, wisps, rays and petals move
// Clouds have no outlines and there are no streak lines anywhere. Clouds,
// wisps and rays hang in the fixed camera's own space; petals fly in the
// world. Nothing here allocates per frame.

import * as THREE from 'three';
import { PETAL_TRAIL_MS, PX_WORLD, SUN_RAY_ANGLES_DEG, SUN_RAY_COUNT, SUN_RAY_DEPTH, SUN_RAY_LENGTH, WIND_LANES, WISP_ALPHA } from '../config.js';
import { artSource } from './art.js';
import { ART, placeholderShape } from './art-assets.js';
import { LANE_NAMES, petalAt, petalPoint, planPetals, trailAt } from './petals.js';
import {
  CLOUD_FRAME_PX, CLOUD_SHAPES, planDriftClouds, planStillClouds, planWisps, screenToView, SKY_ALPHA_CUTOFF,
  skyDrift, skyGradientStops, sunRayAlpha, viewHalfExtent,
} from './sky.js';
import { SPRITE_ALPHA_TEST } from './sprite-frames.js';
import { pixelTexture } from './sprites.js';

const SKY_TEXTURE_ROWS = 1024;
const RAY_WIDTH = 0.2; // the far end of a ray, in ray lengths
const RAY_COLOR = 0xfff1cf; // warm sunlight
const TRAIL = PETAL_TRAIL_MS.length; // ghost copies behind every petal
const FAR_LANE_BLUR = 0.6; // texels: the far lane is slightly blurred
const SKY_RENDER_ORDER = -10; // drifting clouds and wisps draw before the field, the plants and the petals

// Builds the sky into `scene` for the fixed `camera` (its rotation never
// changes) at plain position `cameraPosition`. Returns { setFeatures(features),
// update(timeMs) }. `sunRays` false leaves the sun rays out (?rays=off).
export function createSky(scene, camera, cameraPosition, { sunRays = true } = {}) {
  scene.background = skyTexture();

  // Clouds, wisps and rays in camera space.
  const view = new THREE.Group();
  view.position.copy(camera.position);
  view.quaternion.copy(camera.quaternion);
  scene.add(view);

  const cloudMaterial = new THREE.MeshBasicMaterial({
    map: pixelTexture(artSource(ART.v3.clouds)),
    alphaTest: SPRITE_ALPHA_TEST,
    fog: false,
  });
  const cloudGeometries = Array.from({ length: CLOUD_SHAPES }, (_, f) => cloudGeometry(f));
  const cloudMesh = (c, material = cloudMaterial) => {
    const mesh = new THREE.Mesh(cloudGeometries[c.frame], material);
    mesh.scale.setScalar(c.pxWorld);
    mesh.position.set(c.x, c.y, -c.depth);
    return mesh;
  };

  const still = new THREE.Group();
  for (const c of planStillClouds()) still.add(cloudMesh(c));
  view.add(still);

  const drifting = new THREE.Group();
  // Drifting clouds and wisps blend with real alpha and never cut a pixel
  // that shows (SKY_ALPHA_CUTOFF), behind everything else in the scene.
  const driftMaterial = new THREE.MeshBasicMaterial({
    map: cloudMaterial.map,
    transparent: true,
    alphaTest: SKY_ALPHA_CUTOFF,
    depthWrite: false,
    fog: false,
  });
  const driftClouds = planDriftClouds().map((c) => {
    const mesh = cloudMesh(c, driftMaterial);
    mesh.renderOrder = SKY_RENDER_ORDER;
    drifting.add(mesh);
    return { plan: c, mesh };
  });
  const wispMaterial = new THREE.MeshBasicMaterial({
    map: pixelTexture(wispCanvas()),
    transparent: true,
    opacity: WISP_ALPHA,
    alphaTest: SKY_ALPHA_CUTOFF,
    depthWrite: false,
    fog: false,
  });
  const wisps = planWisps().map((w) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w.width, w.height), wispMaterial);
    mesh.renderOrder = SKY_RENDER_ORDER;
    mesh.position.set(w.x, w.y, -w.depth);
    drifting.add(mesh);
    return { plan: w, mesh };
  });
  const rays = createSunRays();
  rays.group.visible = sunRays;
  drifting.add(rays.group);
  view.add(drifting);

  const petals = createWindPetals(camera, cameraPosition);
  scene.add(petals.group);

  // Everything starts where it is at time 0; without background motion it
  // stays there.
  let moving = false;
  const drift = { x: 0, y: 0 };
  const placeDrifting = (things, timeMs) => {
    for (const thing of things) {
      skyDrift(thing.plan, timeMs, drift);
      thing.mesh.position.x = drift.x;
      thing.mesh.position.y = drift.y;
    }
  };
  const place = (timeMs) => {
    placeDrifting(driftClouds, timeMs);
    placeDrifting(wisps, timeMs);
    rays.update(timeMs);
    if (petals.group.visible) petals.update(timeMs);
  };
  place(0);

  return {
    setFeatures(features) {
      still.visible = features.sky === 'still-clouds';
      drifting.visible = features.sky === 'drifting-clouds';
      petals.group.visible = features.wind;
      moving = features.backgroundMotion;
    },
    update(timeMs) {
      if (moving) place(timeMs);
    },
  };
}

// The gradient of sky.js down the whole view, drawn behind everything.
function skyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = SKY_TEXTURE_ROWS;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  for (const [at, color] of skyGradientStops()) gradient.addColorStop(at, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return pixelTexture(canvas);
}

// A plane one art pixel per unit showing cloud shape `frame`, its flat
// bottom centre at the origin, facing the camera.
function cloudGeometry(frame) {
  const [width, height] = CLOUD_FRAME_PX;
  const geometry = new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0);
  const u0 = frame / CLOUD_SHAPES;
  const u1 = (frame + 1) / CLOUD_SHAPES;
  // PlaneGeometry corners: top left, top right, bottom left, bottom right.
  geometry.attributes.uv.set([u0, 1, u1, 1, u0, 0, u1, 0]);
  return geometry;
}

// A thin soft white streak: fades out toward both ends and both edges.
function wispCanvas() {
  return softCanvas(128, 8, (u, v) => bell(u) * bell(v));
}

// A soft wedge of light: narrow at its start (left), wide and faded out at
// its end (right), soft across.
function rayCanvas() {
  return softCanvas(256, 64, (u, v) => {
    const along = (u + 1) / 2;
    const half = 0.15 + 0.85 * along;
    const across = Math.max(1 - Math.abs(v) / half, 0);
    return smooth(across) * smooth(Math.min(along / 0.1, 1)) * (1 - along) ** 1.6;
  });
}

// A white canvas whose alpha is alpha(u, v) with u and v from -1 to 1.
function softCanvas(width, height, alpha) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(255 * alpha(((x + 0.5) / width) * 2 - 1, ((y + 0.5) / height) * 2 - 1));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function bell(t) {
  return smooth(1 - Math.min(Math.abs(t), 1));
}

// SUN_RAY_COUNT additive wedges fanning from just past the upper left
// corner toward the lower right, breathing with sunRayAlpha.
function createSunRays() {
  const group = new THREE.Group();
  const map = pixelTexture(rayCanvas());
  const length = SUN_RAY_LENGTH * 2 * viewHalfExtent(SUN_RAY_DEPTH).halfW;
  const geometry = new THREE.PlaneGeometry(length, length * RAY_WIDTH).translate(length / 2, 0, 0);
  const corner = screenToView(-0.03, -0.05, SUN_RAY_DEPTH);
  const materials = [];
  for (let i = 0; i < SUN_RAY_COUNT; i++) {
    const material = new THREE.MeshBasicMaterial({
      map,
      color: RAY_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(corner.x, corner.y, -SUN_RAY_DEPTH);
    mesh.rotation.z = (SUN_RAY_ANGLES_DEG[i] * Math.PI) / 180;
    mesh.renderOrder = 10; // after the scene, as light over it
    group.add(mesh);
    materials.push(material);
  }
  return {
    group,
    update(timeMs) {
      for (let i = 0; i < materials.length; i++) materials[i].opacity = sunRayAlpha(i, timeMs);
    },
  };
}

const PETAL_VERTEX = /* glsl */ `
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform vec2 uSize;
  attribute vec3 aOffset;
  attribute float aAlpha;
  attribute float aFrame;
  attribute float aFlip;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vFrame;
  void main() {
    vec3 p = aOffset + uRight * (position.x * uSize.x) + uUp * (position.y * uSize.y);
    // Tumble by mirroring the picture, not the quad: a mirrored quad turns
    // its back to the camera and the material culls it.
    vUv = vec2(0.5 + (uv.x - 0.5) * aFlip, uv.y);
    vAlpha = aAlpha;
    vFrame = aFrame;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const PETAL_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uFrames;
  uniform vec2 uBlur; // in frame UVs, 0 for crisp pixels
  varying vec2 vUv;
  varying float vAlpha;
  varying float vFrame;
  vec4 frameTexel(vec2 uv) {
    uv = clamp(uv, 0.0, 1.0);
    return texture2D(uMap, vec2((min(uv.x, 0.999) + vFrame) / uFrames, uv.y));
  }
  void main() {
    if (vAlpha <= 0.0) discard;
    vec4 texel = frameTexel(vUv);
    float alpha = step(${SPRITE_ALPHA_TEST.toFixed(2)}, texel.a);
    vec3 color = texel.rgb;
    if (uBlur.x > 0.0) {
      // A small soft blur: the texel and its four neighbours, weighted by alpha.
      vec4 sum = vec4(texel.rgb * texel.a, texel.a) * 0.4;
      vec4 e = frameTexel(vUv + vec2(uBlur.x, 0.0));
      sum += vec4(e.rgb * e.a, e.a) * 0.15;
      e = frameTexel(vUv - vec2(uBlur.x, 0.0));
      sum += vec4(e.rgb * e.a, e.a) * 0.15;
      e = frameTexel(vUv + vec2(0.0, uBlur.y));
      sum += vec4(e.rgb * e.a, e.a) * 0.15;
      e = frameTexel(vUv - vec2(0.0, uBlur.y));
      sum += vec4(e.rgb * e.a, e.a) * 0.15;
      alpha = sum.a;
      color = sum.rgb / max(sum.a, 0.001);
    }
    if (alpha <= 0.01) discard;
    gl_FragColor = vec4(color, alpha * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// The wind petals: one instanced quad mesh per lane with TRAIL ghosts and
// then the petal itself for each of its petals (so the petal draws on
// top). Positions, alphas and tumbles are written in place every frame.
function createWindPetals(camera, cameraPosition) {
  const group = new THREE.Group();
  const name = ART.v3.windBits;
  const { width, height, frames } = placeholderShape(name);
  const map = pixelTexture(artSource(name));
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const point = petalPoint();
  const plan = planPetals();
  const lanes = LANE_NAMES.map((laneName) => {
    const petals = plan.filter((p) => p.lane === laneName);
    const count = petals.length * (TRAIL + 1);
    const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    geometry.instanceCount = count;
    const offset = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    const flip = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    const frame = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    petals.forEach((p, i) => frame.array.fill(p.frame, i * (TRAIL + 1), (i + 1) * (TRAIL + 1)));
    geometry.setAttribute('aOffset', offset);
    geometry.setAttribute('aAlpha', alpha);
    geometry.setAttribute('aFlip', flip);
    geometry.setAttribute('aFrame', frame);
    const pxWorld = PX_WORLD * WIND_LANES[laneName].scale;
    const blur = laneName === 'far' ? FAR_LANE_BLUR : 0;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map },
        uFrames: { value: frames },
        uRight: { value: right },
        uUp: { value: up },
        uSize: { value: new THREE.Vector2(width * pxWorld, height * pxWorld) },
        uBlur: { value: new THREE.Vector2(blur / width, blur / height) },
      },
      vertexShader: PETAL_VERTEX,
      fragmentShader: PETAL_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { petals, offset, alpha, flip };
  });

  const write = (lane, index) => {
    lane.offset.setXYZ(index, point.x, point.y, point.z);
    lane.alpha.setX(index, point.alpha);
    lane.flip.setX(index, point.flip);
  };

  return {
    group,
    update(timeMs) {
      for (const lane of lanes) {
        for (let i = 0; i < lane.petals.length; i++) {
          const petal = lane.petals[i];
          const base = i * (TRAIL + 1);
          // Oldest ghost first, the petal last, so it draws on top.
          for (let k = TRAIL - 1; k >= 0; k--) {
            trailAt(petal, timeMs, k, cameraPosition, point);
            write(lane, base + (TRAIL - 1 - k));
          }
          petalAt(petal, timeMs, cameraPosition, point);
          write(lane, base + TRAIL);
        }
        lane.offset.needsUpdate = true;
        lane.alpha.needsUpdate = true;
        lane.flip.needsUpdate = true;
      }
    },
  };
}
