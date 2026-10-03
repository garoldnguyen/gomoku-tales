// HD-2D sprite system (docs/art-direction-hd2d.md section D).
//
// A sprite is an upright plane whose feet stand on a ground point. It turns
// only around the vertical axis to face the camera and never tilts. One art
// pixel is PX_WORLD world units wide for every sprite (and SPRITE_STRETCH_Y
// times that tall, so pixels look square from the tilted camera). Textures use NearestFilter
// without mipmaps and alphaTest cutout edges. Animations are sprite sheets
// with all frames in one row. Every sprite has a soft blob shadow.

import * as THREE from 'three';
import { PX_WORLD, SPRITE_STRETCH_Y } from '../config.js';
import { anchorForward, anchorShift, faceYaw, frameAt, SPRITE_ALPHA_TEST } from './sprite-frames.js';
import { bendTowardPx, swayLeanSide, swayPhase } from './wind.js';

const SHADOW_OPACITY = 0.35;
export const SHADOW_DEPTH = 0.8; // the blob is an ellipse this much shorter in z
// Sprite normals lean back towards the sky, so the sun and the hemisphere
// light an upright sprite about as brightly as the ground it stands on.
const NORMAL_LEAN_RAD = Math.PI / 4;

// Flat things lying on the field or the meadow (decals, the path, blob
// shadows) sit at the same height as it and are drawn over it by polygon
// offset, never lifted by a tiny height, so they never fight in depth.
export const ON_SURFACE = Object.freeze({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });

// Canvas texture with crisp pixels: NearestFilter both ways, no mipmaps, sRGB.
export function pixelTexture(source) {
  const texture = new THREE.CanvasTexture(source);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Draws pixel grids (src/render3d/pixel-art.js) side by side into one
// canvas: a sprite sheet with all frames in one row.
export function sheetCanvas(frames) {
  const { width, height } = frames[0];
  const canvas = document.createElement('canvas');
  canvas.width = width * frames.length;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, height);
  frames.forEach((grid, f) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const color = grid.pixels[y * width + x];
        if (!color) continue;
        const i = (y * canvas.width + f * width + x) * 4;
        const rgb = parseInt(color.slice(1), 16);
        image.data[i] = rgb >> 16;
        image.data[i + 1] = (rgb >> 8) & 0xff;
        image.data[i + 2] = rgb & 0xff;
        image.data[i + 3] = 255;
      }
    }
  });
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// Upright plane geometry `widthPx` x `heightPx` art pixels at `pxWorld`
// units per pixel (stretched in height by `stretchY`), with its origin at the
// bottom centre (the feet) and its normals leaning back towards the sky.
// `rows` splits it into rows of vertices, for planes a shader bends.
export function uprightPlaneGeometry(widthPx, heightPx, pxWorld = PX_WORLD, stretchY = SPRITE_STRETCH_Y, rows = 1) {
  const width = widthPx * pxWorld;
  const height = heightPx * pxWorld * stretchY;
  const geometry = new THREE.PlaneGeometry(width, height, 1, rows);
  geometry.translate(0, height / 2, 0);
  const normals = geometry.attributes.normal;
  for (let i = 0; i < normals.count; i++) {
    normals.setXYZ(i, 0, Math.sin(NORMAL_LEAN_RAD), Math.cos(NORMAL_LEAN_RAD));
  }
  return geometry;
}

// Lit cutout material for sprites and billboards.
export function spriteMaterial(map) {
  return new THREE.MeshLambertMaterial({ map, alphaTest: SPRITE_ALPHA_TEST });
}

// The sway of the resting X and O plants (docs/art-direction-v3.md section
// 6, High only), shared by every swaying sprite: the wave angle and the
// amplitude in art pixels (0: still). The meadow (meadow-scene.js) sets
// them each frame from the same wind and gusts as the flowers, at half
// their amplitude.
export const PLANT_SWAY = { uSwayAngle: { value: 0 }, uSwayPx: { value: 0 } };

// A sprite material that, while uSwayOn is 1, leans each art pixel row of
// the frame downwind by whole pixels (and on any frame leans it by uBendPx
// at the top towards a Tornado Zone, see bendRowPx in wind.js): the lean grows with the square of
// the row's height above the root row (rootRow from the bottom), the same
// formula as plantSwayLeanPx in wind.js. It shifts where each row reads the
// sheet, so the single quad stays put and no pixel is ever split.
function swayingSpriteMaterial(map, { frames, widthPx, heightPx, rootRow }) {
  const material = spriteMaterial(map);
  const uniforms = {
    ...PLANT_SWAY,
    uSwayOn: { value: 0 },
    uSwayPhase: { value: 0 },
    uWindSide: { value: 1 },
    uBendPx: { value: 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSwayAngle;
uniform float uSwayPx;
uniform float uSwayOn;
uniform float uSwayPhase;
uniform float uWindSide;
uniform float uBendPx;`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
vec2 swayUv = vMapUv;
float swayPx = uSwayPx * uSwayOn;
if (swayPx > 0.0 || uBendPx != 0.0) {
  float row = floor(vMapUv.y * ${heightPx.toFixed(1)});
  float h = clamp((row - ${rootRow.toFixed(1)}) / ${Math.max(heightPx - 1 - rootRow, 1).toFixed(1)}, 0.0, 1.0);
  float leanPx = 0.0;
  if (swayPx > 0.0) {
    // Same formula as plantSwayLeanPx in wind.js.
    float reach = swayPx * h * h;
    float wave = sin(uSwayAngle + uSwayPhase);
    leanPx = uWindSide * (reach >= 1.0
      ? floor(reach * (0.5 + 0.5 * wave) + 0.5)
      : (reach > 0.0 && wave >= cos(${(Math.PI / 2).toFixed(6)} * reach) ? 1.0 : 0.0));
  }
  // The bend towards a Tornado Zone, same formula as bendRowPx in wind.js.
  float bend = uBendPx * h * h;
  leanPx += sign(bend) * floor(abs(bend) + 0.5);
  swayUv.x -= leanPx / ${(widthPx * frames).toFixed(1)};
}
vec4 sampledDiffuseColor = texture2D(map, swayUv);
// A row never reads from the next frame of the sheet.
if (floor(swayUv.x * ${frames.toFixed(1)}) != floor(vMapUv.x * ${frames.toFixed(1)})) sampledDiffuseColor.a = 0.0;
diffuseColor *= sampledDiffuseColor;
#endif`);
  };
  material.customProgramCacheKey = () => `sprite-sway-${frames}-${widthPx}-${heightPx}-${rootRow}`;
  material.userData.sway = uniforms;
  return material;
}

// Soft round shadow texture shared by every blob shadow.
let blobTexture = null;
function blobShadowTexture() {
  if (blobTexture) return blobTexture;
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.7)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  blobTexture = pixelTexture(canvas);
  return blobTexture;
}

let blobMaterial = null;
let blobGeometry = null;

// The material of every blob shadow: soft, dark plum, see-through.
export function blobShadowMaterial() {
  blobMaterial ??= new THREE.MeshBasicMaterial({
    map: blobShadowTexture(),
    color: 0x1a1030,
    transparent: true,
    opacity: SHADOW_OPACITY,
    depthWrite: false,
    ...ON_SURFACE,
  });
  return blobMaterial;
}

// A flat 1 x 1 square lying on y = 0, the shape of every blob shadow.
export function blobShadowGeometry() {
  blobGeometry ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  return blobGeometry;
}

// A flat soft blob shadow, `radius` world units wide, lying on y = 0 of its parent.
export function createBlobShadow(radius) {
  const shadow = new THREE.Mesh(blobShadowGeometry(), blobShadowMaterial());
  shadow.scale.set(radius * 2, 1, radius * 2 * SHADOW_DEPTH);
  return shadow;
}

const sheetTextures = new WeakMap(); // sheet canvas -> base texture
const geometries = new Map(); // "w x h" -> shared upright plane geometry

function baseTexture(sheet) {
  let texture = sheetTextures.get(sheet);
  if (!texture) {
    texture = pixelTexture(sheet);
    sheetTextures.set(sheet, texture);
  }
  return texture;
}

function sharedGeometry(widthPx, heightPx) {
  const key = `${widthPx}x${heightPx}`;
  if (!geometries.has(key)) geometries.set(key, uprightPlaneGeometry(widthPx, heightPx));
  return geometries.get(key);
}

// One pixel sprite standing on the ground.
//   sheet       canvas with all frames in one row (see sheetCanvas)
//   frameCount  number of frames in the sheet
//   frameMs     time per frame; 0 means the frame only changes through
//               setFrame (a still sprite, or one its owner steps)
//   shadowRadius  blob shadow radius in world units
//   phaseMs     offsets the animation so neighbours do not move in step
//   frameFor    optional (timeMs) => frame index; replaces the looping
//               animation, for sheets that hold several animations
//   anchor      optional art pixel { x, y } of a frame that stands on the
//               ground point (default: the bottom centre)
//   swayFrame   optional frame that sways with PLANT_SWAY (the Rest frame
//               of an X or O plant); its root (the anchor row) never moves
export class PixelSprite {
  constructor({ sheet, frameCount = 1, frameMs = 0, shadowRadius, phaseMs = 0, frameFor = null, anchor = null, swayFrame = null }) {
    this.frameCount = frameCount;
    this.frameMs = frameMs;
    this.phaseMs = phaseMs;
    this.frameFor = frameFor;
    this.frame = -1;

    const frameWidth = sheet.width / frameCount;
    // Sprites that share a sheet share its image on the GPU; animated ones
    // need their own texture object for their own frame offset.
    const base = baseTexture(sheet);
    this.texture = frameCount > 1 ? base.clone() : base;
    this.texture.repeat.set(1 / frameCount, 1);

    this.swayFrame = swayFrame;
    const material = swayFrame === null ? spriteMaterial(this.texture) : swayingSpriteMaterial(this.texture, {
      frames: frameCount,
      widthPx: frameWidth,
      heightPx: sheet.height,
      rootRow: anchor ? sheet.height - 1 - anchor.y : 0,
    });
    this.sway = material.userData.sway ?? null;
    // The pull of a Tornado Zone swirl (setBend): how far the top leans
    // when the swirl is straight beside the plant, and where the swirl is.
    this.bendPx = 0;
    this.bendX = 0;
    this.bendZ = 0;
    this.plane = new THREE.Mesh(sharedGeometry(frameWidth, sheet.height), material);
    this.anchor = anchorShift(frameWidth, sheet.height, anchor, PX_WORLD, SPRITE_STRETCH_Y);
    this.shadow = createBlobShadow(shadowRadius ?? (frameWidth * PX_WORLD) / 3);

    this.object = new THREE.Group();
    this.object.add(this.shadow, this.plane);
    this.setFrame(0);
  }

  // Puts the sprite's feet on a ground point.
  placeAt(x, y, z) {
    this.object.position.set(x, y, z);
    return this;
  }

  setFrame(frame) {
    if (frame === this.frame) return;
    this.frame = frame;
    this.texture.offset.x = frame / this.frameCount;
    if (this.sway) this.sway.uSwayOn.value = frame === this.swayFrame ? 1 : 0;
  }

  // Leans a swaying sprite's top up to `px` art pixels towards the point
  // (x, z) on the ground (a Tornado Zone swirl); 0 stands it straight.
  setBend(px, x, z) {
    this.bendPx = px;
    this.bendX = x;
    this.bendZ = z;
  }

  // Advances the animation and turns the sprite towards the camera. An
  // anchored plane is moved along its own width and towards the camera so
  // the anchor pixel stays on the ground point, along this sprite's own
  // camera ray (the perspective camera sees each plot from its own angle).
  update(timeMs, cameraPosition) {
    if (this.frameFor) this.setFrame(this.frameFor(timeMs));
    else if (this.frameMs > 0) this.setFrame(frameAt(timeMs + this.phaseMs, this.frameCount, this.frameMs));
    const yaw = faceYaw(this.object.position, cameraPosition);
    this.plane.rotation.y = yaw;
    if (this.sway) {
      // Per-plant phase from where it stands; downwind along its width.
      this.sway.uSwayPhase.value = swayPhase(this.object.position.x, this.object.position.z);
      this.sway.uWindSide.value = swayLeanSide(Math.cos(yaw), Math.sin(yaw));
      const { uBendPx } = this.sway;
      if (this.bendPx !== 0 || uBendPx.value !== 0) {
        const { x, z } = this.object.position;
        uBendPx.value = bendTowardPx(x, z, this.bendX, this.bendZ, Math.cos(yaw), Math.sin(yaw), this.bendPx);
      }
    }
    const { side, lift } = this.anchor;
    if (side !== 0 || lift !== 0) {
      const forward = anchorForward(lift, this.object.position, cameraPosition);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      this.plane.position.x = side * cos + forward * sin;
      this.plane.position.z = forward * cos - side * sin;
    }
  }
}

// Many copies of one still billboard drawn in a single draw call (for
// example wildflowers). Each faces the camera around the vertical axis.
// Instanced billboards are scenery and have no blob shadows.
export function createInstancedBillboards({ sheet, positions, cameraPosition }) {
  const geometry = uprightPlaneGeometry(sheet.width, sheet.height);
  const mesh = new THREE.InstancedMesh(geometry, spriteMaterial(baseTexture(sheet)), positions.length);
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3(1, 1, 1);
  const position = new THREE.Vector3();
  positions.forEach((p, i) => {
    rotation.setFromAxisAngle(up, faceYaw(p, cameraPosition));
    matrix.compose(position.set(p.x, p.y, p.z), rotation, scale);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
