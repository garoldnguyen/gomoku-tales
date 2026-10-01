// Pure sprite helpers (docs/art-direction-hd2d.md section D): which sheet
// frame to show at a given time, and how far to turn an upright sprite
// around the vertical axis to face the camera. No Three.js imports, so they
// run under node --test.

// Index of the sprite sheet frame to show `timeMs` after the animation
// started. Every frame lasts `frameMs`. A looping animation wraps around; a
// one-shot animation (loop: false) holds its last frame. Times before the
// start show frame 0.
export function frameAt(timeMs, frameCount, frameMs, { loop = true } = {}) {
  if (frameCount <= 1 || !(frameMs > 0) || !(timeMs > 0)) return 0;
  const step = Math.floor(timeMs / frameMs);
  return loop ? step % frameCount : Math.min(step, frameCount - 1);
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
