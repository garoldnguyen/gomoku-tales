// HD-2D sprite system (docs/art-direction-hd2d.md section D).
//
// A sprite is an upright plane whose feet stand on a ground point. It turns
// only around the vertical axis to face the camera and never tilts. One art
// pixel is PX_WORLD world units wide for every sprite (and SPRITE_STRETCH_Y
// times that tall, so pixels look square from the tilted camera). Textures use NearestFilter
// without mipmaps and alphaTest cutout edges. Animations are sprite sheets
// with all frames in one row. Every sprite has a soft blob shadow (Medium)
// and a long sun shadow (High), and its owner shows at most one of them.

import * as THREE from 'three';
import { PX_WORLD, SPRITE_STRETCH_Y, SUN_SHADOW_OPACITY } from '../config.js';
import { FADE_THRESHOLD_GLSL } from './plant-frames.js';
import { sunShadowCorners } from './shadow-math.js';
import { anchorForward, anchorShift, faceYaw, frameAt, SPRITE_ALPHA_TEST, visibleTopRow } from './sprite-frames.js';
import { bendTowardPx, swayLeanSide, swayPhase } from './wind.js';

const SHADOW_OPACITY = 0.35;
const SHADOW_COLOR = 0x1a1030; // dark plum, for blob and sun shadows alike
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
// the row's height above the root row (rootRow from the bottom) over the
// height of the top visible row (topRow), the same formula as
// plantSwayLeanPx with swayRowFraction in wind.js. It shifts where each row reads the
// sheet, so the single quad stays put and no pixel is ever split. While
// uFade is above 0 it also cross-fades into the frame uFadeShift (in sheet
// UVs) further along (the in-between growth frames, plant-frames.js): the
// colours mix by their alphas, and each art pixel shows or is cut whole by
// an ordered threshold (fadeShows), so pixels in only one frame fade too.
function swayingSpriteMaterial(map, { frames, widthPx, heightPx, rootRow, topRow }) {
  const material = spriteMaterial(map);
  const uniforms = {
    ...PLANT_SWAY,
    uSwayOn: { value: 0 },
    uSwayPhase: { value: 0 },
    uWindSide: { value: 1 },
    uBendPx: { value: 0 },
    uFade: { value: 0 },
    uFadeShift: { value: 0 },
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
uniform float uBendPx;
uniform float uFade;
uniform float uFadeShift;
${FADE_THRESHOLD_GLSL}`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
vec2 swayUv = vMapUv;
float swayPx = uSwayPx * uSwayOn;
if (swayPx > 0.0 || uBendPx != 0.0) {
  float row = floor(vMapUv.y * ${heightPx.toFixed(1)});
  float h = clamp((row - ${rootRow.toFixed(1)}) / ${Math.max(topRow - rootRow, 1).toFixed(1)}, 0.0, 1.0);
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
if (uFade > 0.0) {
  vec4 fadeColor = texture2D(map, swayUv + vec2(uFadeShift, 0.0));
  if (floor((swayUv.x + uFadeShift) * ${frames.toFixed(1)}) != floor((vMapUv.x + uFadeShift) * ${frames.toFixed(1)})) fadeColor.a = 0.0;
  float fromA = sampledDiffuseColor.a * (1.0 - uFade);
  float toA = fadeColor.a * uFade;
  float sumA = fromA + toA;
  // Whole art pixels: shown where the mixed cover passes the pixel's
  // ordered threshold (fadeShows in plant-frames.js), else cut out.
  vec2 artPx = floor(swayUv * vec2(${(widthPx * frames).toFixed(1)}, ${heightPx.toFixed(1)}));
  float shows = sumA > plantFadeThreshold(artPx) ? 1.0 : 0.0;
  sampledDiffuseColor = vec4(sumA > 0.0 ? (sampledDiffuseColor.rgb * fromA + fadeColor.rgb * toA) / sumA : sampledDiffuseColor.rgb, shows);
}
diffuseColor *= sampledDiffuseColor;
#endif`);
  };
  material.customProgramCacheKey = () => `sprite-sway-${frames}-${widthPx}-${heightPx}-${rootRow}-${topRow}`;
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
    color: SHADOW_COLOR,
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

// Flat geometry on y = 0 for the long sun shadow of a frame widthPx x
// heightPx whose root row is rootRow rows up (sunShadowCorners in
// shadow-math.js), its root at the origin. Shared per size.
const sunShadowGeometries = new Map();
export function sunShadowGeometry(widthPx, heightPx, rootRow = 0) {
  const key = `${widthPx}x${heightPx}@${rootRow}`;
  if (!sunShadowGeometries.has(key)) {
    const corners = sunShadowCorners(widthPx, heightPx, rootRow);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap((c) => [c.x, 0, c.z]), 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(corners.flatMap(() => [0, 1, 0]), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(corners.flatMap((c) => [c.u, c.v]), 2));
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    geometry.computeBoundingSphere();
    sunShadowGeometries.set(key, geometry);
  }
  return sunShadowGeometries.get(key);
}

// The material of a long sun shadow: the frame's silhouette (every texel
// the sprite's alpha test keeps) in dark plum at SUN_SHADOW_OPACITY,
// lying on the ground and drawn over it by polygon offset. `map` is the
// sprite's own texture, so the shadow shows the same frame. Both sides
// draw, whichever way the shear turns the quad. `onBeforeCompile` may add
// more shader code (the meadow's frame and mirror per instance).
export function sunShadowMaterial(map, { key = 'sun-shadow', vertex = null } = {}) {
  const material = new THREE.MeshBasicMaterial({
    map,
    color: SHADOW_COLOR,
    transparent: true,
    opacity: SUN_SHADOW_OPACITY,
    alphaTest: 0.01, // the cut-out texels
    depthWrite: false,
    side: THREE.DoubleSide,
    ...ON_SURFACE,
  });
  material.onBeforeCompile = (shader) => {
    if (vertex) vertex(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
diffuseColor.a *= step(${SPRITE_ALPHA_TEST.toFixed(2)}, texture2D(map, vMapUv).a);
#endif`);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

const sheetTextures = new WeakMap(); // sheet canvas -> base texture
const geometries = new Map(); // "w x h" -> shared upright plane geometry

// The top visible row of frame `frame` of a sheet (visibleTopRow), read
// once per sheet and frame. A sheet whose pixels cannot be read gives its
// top row.
const sheetTopRows = new WeakMap();
export function sheetTopRow(sheet, frameWidth, frame) {
  let rows = sheetTopRows.get(sheet);
  if (!rows) {
    rows = new Map();
    sheetTopRows.set(sheet, rows);
  }
  if (!rows.has(frame)) {
    let top = sheet.height - 1;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = sheet.width;
      canvas.height = sheet.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(sheet, 0, 0);
      const { data } = ctx.getImageData(0, 0, sheet.width, sheet.height);
      top = visibleTopRow((x, y) => data[(y * sheet.width + x) * 4 + 3], frameWidth, sheet.height, frame);
    } catch (error) {
      console.warn('Sway: cannot read the sprite sheet pixels, swaying from its top row', error);
    }
    rows.set(frame, top);
  }
  return rows.get(frame);
}

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
      topRow: sheetTopRow(sheet, frameWidth, swayFrame),
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
    // The long sun shadow from the root row, under the anchor pixel. The
    // camera faces the board almost straight on, so it lies along world x.
    this.sunShadow = new THREE.Mesh(
      sunShadowGeometry(frameWidth, sheet.height, anchor ? sheet.height - 1 - anchor.y : 0),
      sunShadowMaterial(this.texture),
    );
    this.sunShadow.position.x = this.anchor.side;
    this.sunShadow.visible = false;

    this.object = new THREE.Group();
    this.object.add(this.shadow, this.sunShadow, this.plane);
    this.blobScaleX = this.shadow.scale.x;
    this.blobScaleZ = this.shadow.scale.z;
    this.setFrame(0);
  }

  // Scales both shadows around the feet by `factor` (1: full size), for a
  // sprite lifted off the ground.
  setShadowScale(factor) {
    this.shadow.scale.x = this.blobScaleX * factor;
    this.shadow.scale.z = this.blobScaleZ * factor;
    this.sunShadow.scale.x = factor;
    this.sunShadow.scale.z = factor;
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

  // Shows frame `from` cross-faded into frame `to` by `mix` (0: all
  // `from`), on swaying sprites (the plants); others show `from`.
  setBlend(from, to, mix) {
    this.setFrame(from);
    if (!this.sway) return;
    this.sway.uFade.value = to === from ? 0 : mix;
    this.sway.uFadeShift.value = (to - from) / this.frameCount;
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

