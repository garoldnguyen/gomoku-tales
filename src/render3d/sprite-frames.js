// Pure sprite helpers (docs/art-direction-hd2d.md section D): which sheet
// frame to show at a given time, and how far to turn an upright sprite
// around the vertical axis to face the camera. No Three.js imports, so they
// run under node --test.

// Sprite materials discard fragments whose alpha is below this (cutout edges).
export const SPRITE_ALPHA_TEST = 0.5;

// Cutout threshold for a sprite drawn at `opacity`. Three.js multiplies the
// texel alpha by the material opacity before the alpha test, so a faded
// sprite needs a threshold scaled the same way: opaque art pixels still pass
// and fully transparent ones are still cut out.
export function fadedAlphaTest(opacity, alphaTest = SPRITE_ALPHA_TEST) {
  return alphaTest * opacity;
}

// The highest art pixel row, counted from the bottom (0), of frame `frame`
// of a sheet `frameWidth` art pixels per frame and `heightPx` tall that
// keeps any pixel through the alpha test. `alphaAt(x, y)` gives the alpha
// (0 to 255) of sheet pixel (x, y), y counted from the top. A frame with
// no visible pixel gives heightPx - 1, the top of the frame.
export function visibleTopRow(alphaAt, frameWidth, heightPx, frame = 0, alphaTest = SPRITE_ALPHA_TEST) {
  for (let y = 0; y < heightPx; y++) {
    for (let x = frame * frameWidth; x < (frame + 1) * frameWidth; x++) {
      if (alphaAt(x, y) >= alphaTest * 255) return heightPx - 1 - y;
    }
  }
  return heightPx - 1;
}

// Index of the sprite sheet frame to show `timeMs` after the animation
// started. Every frame lasts `frameMs`. A looping animation wraps around; a
// one-shot animation (loop: false) holds its last frame. Times before the
// start show frame 0. `options` is any object with a `loop` flag (missing:
// true); the default is shared, so a call allocates nothing.
const LOOPING = Object.freeze({ loop: true });
export function frameAt(timeMs, frameCount, frameMs, options = LOOPING) {
  if (frameCount <= 1 || !(frameMs > 0) || !(timeMs > 0)) return 0;
  const step = Math.floor(timeMs / frameMs);
  return (options.loop ?? true) ? step % frameCount : Math.min(step, frameCount - 1);
}

// Where art pixel `anchor` { x, y } of an upright sprite's frame (widthPx
// x heightPx, each pixel pxWorld wide and pxWorld * stretchY tall) sits on
// the plane: { side, lift } in world units. side moves the plane along its
// own width so the anchor is above the ground point; lift is the anchor's
// height above the plane's foot (see anchorForward for how far the plane
// then stands towards the camera). With no anchor the sprite stands on its
// bottom centre: { side: 0, lift: 0 }. As in v3-meta.json (a 24 x 16
// bottom-centre sprite has anchor (12, 15)), the anchor pixel's bottom left
// corner is the point on the ground, so only the rows below the anchor row
// count.
export function anchorShift(widthPx, heightPx, anchor, pxWorld, stretchY) {
  if (!anchor) return { side: 0, lift: 0 };
  return {
    side: (widthPx / 2 - anchor.x) * pxWorld,
    lift: (heightPx - 1 - anchor.y) * pxWorld * stretchY,
  };
}

// How far towards the camera (on the ground) to stand an upright plane on
// `ground` { x, y, z } so that a point `lift` above its foot lies on the
// camera ray through `ground`, as seen from the perspective camera at
// `camera` { x, y, z }. The rows below the anchor are drawn by standing the
// plane nearer the camera rather than sinking it into the ground, so they
// are never cut off by the board. The ray to each plot has its own slope,
// so this is worked out per sprite rather than from the camera pitch.
export function anchorForward(lift, ground, camera) {
  const height = camera.y - ground.y;
  if (lift === 0 || !(height > 0)) return 0;
  return (lift * Math.hypot(camera.x - ground.x, camera.z - ground.z)) / height;
}

// Rotation around +y (radians) that turns a plane facing +z at `from` so it
// faces `to` on the horizontal plane. Height differences are ignored, so the
// sprite stays upright and never tilts.
export function faceYaw(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}
