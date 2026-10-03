// Slow cloud shadows on High (docs/art-direction-v3.md section 7): large
// soft patches on the plots and the meadow, a multiply layer that is never
// darker than CLOUD_SHADOW_TINT (about 25 percent), sliding with the near
// cloud layer along the one wind (cloudShadowOffset in shadow-math.js).
// One flat mesh over the whole ground, one texture read per pixel, built
// once; nothing here allocates per frame.

import * as THREE from 'three';
import { CLOUD_SHADOW_MASK_PX, CLOUD_SHADOW_TILE, CLOUD_SHADOW_TINT, MEADOW_SEED } from '../config.js';
import { seededRandom } from './seeded-random.js';
import { cloudShadowOffset } from './shadow-math.js';
import { FAR_EDGE_WAVE_Z } from './horizon.js';
import { ON_SURFACE } from './sprites.js';
import { GROUND_Y, TERRAIN_GRID } from './terrain.js';

const MASK_PX = CLOUD_SHADOW_MASK_PX; // the soft mask tile, CLOUD_SHADOW_TILE world units wide
const CLOUDS_PER_TILE = 4;
const PUFFS_PER_CLOUD = 5;
const RENDER_ORDER = -1; // before the decals, so a mark is never dimmed

// Builds the layer into `scene`. Returns { mesh, setFeatures(features),
// update(timeMs) }: it shows with the 'sun' shadow mode and slides while
// the background moves, along both ground axes of the wind: uOffset is a
// vec2 of ground (x, z), so the wind's x travel goes in its x and its z
// (depth) travel in its y.
export function createCloudShadows(scene) {
  const { minX, maxX, maxZ } = TERRAIN_GRID;
  // Inside the ground's wavy far edge (horizon.js), so it never darkens the sky.
  const minZ = TERRAIN_GRID.minZ + FAR_EDGE_WAVE_Z;
  const geometry = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ)
    .rotateX(-Math.PI / 2)
    .translate((minX + maxX) / 2, GROUND_Y, (minZ + maxZ) / 2);
  const mask = new THREE.CanvasTexture(maskCanvas());
  mask.wrapS = THREE.RepeatWrapping;
  mask.wrapT = THREE.RepeatWrapping;
  mask.colorSpace = THREE.NoColorSpace; // a mask, not a colour
  mask.generateMipmaps = false; // soft already, and seen at about one size
  mask.minFilter = THREE.LinearFilter;
  mask.magFilter = THREE.LinearFilter;
  const offset = new THREE.Vector2(); // ground (x, z) as the vec2 (x, y)
  const drift = { x: 0, z: 0 }; // cloudShadowOffset writes here, reused
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uOffset: { value: offset },
      uTile: { value: CLOUD_SHADOW_TILE },
      uTint: { value: new THREE.Vector3(...CLOUD_SHADOW_TINT) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vGround;
      void main() {
        vGround = (modelMatrix * vec4(position, 1.0)).xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    // Same formula as cloudShadowShade in shadow-math.js.
    fragmentShader: /* glsl */ `
      uniform sampler2D uMask;
      uniform vec2 uOffset;
      uniform float uTile;
      uniform vec3 uTint;
      varying vec2 vGround;
      void main() {
        float m = clamp(texture2D(uMask, (vGround - uOffset) / uTile).r, 0.0, 1.0);
        if (m <= 0.0) discard;
        gl_FragColor = vec4(1.0 - (1.0 - uTint) * m, 1.0);
      }
    `,
    // Multiply: the colour already drawn times this one.
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    depthWrite: false,
    toneMapped: false,
    ...ON_SURFACE,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = RENDER_ORDER;
  mesh.visible = false;
  scene.add(mesh);

  let moving = false;
  return {
    mesh,
    setFeatures(features) {
      mesh.visible = features.shadows === 'sun';
      moving = features.backgroundMotion;
    },
    update(timeMs) {
      if (!mesh.visible || !moving) return;
      cloudShadowOffset(timeMs, drift);
      offset.x = drift.x;
      offset.y = drift.z; // the depth axis: vGround.y in the shader is world z
    },
  };
}

// The soft mask tile: white where a cloud shadow lies, black between. Each
// cloud is a few overlapping soft round puffs, drawn again one tile over
// on every side so the tile repeats without a seam.
function maskCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = MASK_PX;
  canvas.height = MASK_PX;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, MASK_PX, MASK_PX);
  ctx.globalCompositeOperation = 'lighter';
  const random = seededRandom(MEADOW_SEED + 11);
  const k = MASK_PX / 128; // puff sizes are set for a 128 pixel tile; the same look at any resolution
  for (let c = 0; c < CLOUDS_PER_TILE; c++) {
    const cx = random() * MASK_PX;
    const cy = random() * MASK_PX;
    for (let p = 0; p < PUFFS_PER_CLOUD; p++) {
      // Stretched along x a little, like the clouds above.
      const x = cx + (random() - 0.5) * 34 * k;
      const y = cy + (random() - 0.5) * 16 * k;
      const r = (10 + random() * 12) * k;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) puff(ctx, x + dx * MASK_PX, y + dy * MASK_PX, r);
      }
    }
  }
  return canvas;
}

function puff(ctx, x, y, r) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
