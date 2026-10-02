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

const SHADOW_LIFT = 0.005; // keeps the blob shadow just above the ground
const SHADOW_OPACITY = 0.35;
const SHADOW_DEPTH = 0.8; // the blob is an ellipse this much shorter in z
// Sprite normals lean back towards the sky, so the sun and the hemisphere
// light an upright sprite about as brightly as the ground it stands on.
const NORMAL_LEAN_RAD = Math.PI / 4;

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
export function uprightPlaneGeometry(widthPx, heightPx, pxWorld = PX_WORLD, stretchY = SPRITE_STRETCH_Y) {
  const width = widthPx * pxWorld;
  const height = heightPx * pxWorld * stretchY;
  const geometry = new THREE.PlaneGeometry(width, height);
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

// A flat soft blob shadow, `radius` world units wide, lying on y = 0 of its parent.
export function createBlobShadow(radius) {
  blobMaterial ??= new THREE.MeshBasicMaterial({
    map: blobShadowTexture(),
    color: 0x1a1030,
    transparent: true,
    opacity: SHADOW_OPACITY,
    depthWrite: false,
  });
  blobGeometry ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(blobGeometry, blobMaterial);
  shadow.scale.set(radius * 2, 1, radius * 2 * SHADOW_DEPTH);
  shadow.position.y = SHADOW_LIFT;
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
export class PixelSprite {
  constructor({ sheet, frameCount = 1, frameMs = 0, shadowRadius, phaseMs = 0, frameFor = null, anchor = null }) {
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

    this.plane = new THREE.Mesh(sharedGeometry(frameWidth, sheet.height), spriteMaterial(this.texture));
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
