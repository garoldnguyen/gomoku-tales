// Pure shadow math for High (docs/art-direction-v3.md sections 5 and 7):
// the long sun shadow of an upright sprite and the slow cloud shadows.
// No Three.js imports, so this runs under node --test.

import {
  CLOUD_LAYERS, CLOUD_SHADOW_TILE, CLOUD_SHADOW_TINT, PX_WORLD, SPRITE_STRETCH_Y, SUN_SHADOW_DIR, SUN_SHADOW_LENGTH,
} from '../config.js';
import { wrapAround } from './sky.js';
import { WIND_GROUND } from './wind.js';

// The way sun shadows fall on the ground: a unit vector { x, z }. The sun
// is in the upper left, so they fall toward the lower right of the screen.
const DIR_LENGTH = Math.hypot(SUN_SHADOW_DIR[0], SUN_SHADOW_DIR[2]);
export const SUN_SHADOW_GROUND = Object.freeze({ x: SUN_SHADOW_DIR[0] / DIR_LENGTH, z: SUN_SHADOW_DIR[2] / DIR_LENGTH });

// The flat quad on the ground that shows the sheared silhouette of an
// upright sprite frame widthPx x heightPx art pixels whose root (the row
// that stands on the ground point, rootRow rows up from the bottom) is at
// the origin. Returns the four corners { x, z, u, v } in PlaneGeometry
// order (top left, top right, bottom left, bottom right of the frame):
// each frame row lies `length` times its height above the root along the
// shadow direction, so the row on the ground stays under the sprite and
// the top falls farthest. Rows below the root fall the other way, a little.
export function sunShadowCorners(widthPx, heightPx, rootRow = 0, {
  pxWorld = PX_WORLD, stretchY = SPRITE_STRETCH_Y, length = SUN_SHADOW_LENGTH, dir = SUN_SHADOW_GROUND,
} = {}) {
  const halfWidth = (widthPx * pxWorld) / 2;
  const rowHeight = pxWorld * stretchY;
  const along = (v) => (v * heightPx - rootRow) * rowHeight * length;
  const corner = (u, v) => ({ x: (u - 0.5) * 2 * halfWidth + along(v) * dir.x, z: along(v) * dir.z, u, v });
  return [corner(0, 1), corner(1, 1), corner(0, 0), corner(1, 0)];
}

// The multiply colour [r, g, b] of a cloud shadow where its soft mask is
// `mask` (0 open sky to 1 the heart of a shadow): never darker than
// CLOUD_SHADOW_TINT, so at most about 25 percent of the light goes.
export function cloudShadowShade(mask, out = [0, 0, 0]) {
  const m = Math.min(Math.max(Number.isFinite(mask) ? mask : 0, 0), 1);
  for (let i = 0; i < 3; i++) out[i] = 1 - (1 - CLOUD_SHADOW_TINT[i]) * m;
  return out;
}

// How far the cloud shadow pattern has slid `timeMs` after the start,
// written into `out` { x, z } (no allocation): with the near cloud layer's
// speed along the one wind, wrapped into one pattern tile so the numbers
// stay small. The pattern repeats every tile, so the wrap never shows.
export function cloudShadowOffset(timeMs, out, tile = CLOUD_SHADOW_TILE, speed = CLOUD_LAYERS.near.speed) {
  const travel = (speed * timeMs) / 1000;
  out.x = wrapAround(travel * WIND_GROUND.x, 0, tile);
  out.z = wrapAround(travel * WIND_GROUND.z, 0, tile);
  return out;
}
