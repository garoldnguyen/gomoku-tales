// Pure camera math for the fixed HD-2D camera (docs/art-direction-hd2d.md
// section B). No Three.js imports, so it runs under node --test.
// Vectors are plain { x, y, z } objects; the world is y-up.

const DEG = Math.PI / 180;

// Camera position looking down at `target` by `pitchDeg` degrees from
// `distance` away, from the +z side (the near edge of the board).
export function cameraPosition(pitchDeg, distance, target = { x: 0, y: 0, z: 0 }) {
  const pitch = pitchDeg * DEG;
  return {
    x: target.x,
    y: target.y + distance * Math.sin(pitch),
    z: target.z + distance * Math.cos(pitch),
  };
}

// World-space ray through a point in normalized device coordinates
// (x and y from -1 to 1, y up) for a perspective camera at `position`
// looking at `target` with a world-up of +y. Same result as
// THREE.Raycaster.setFromCamera after camera.lookAt(target).
export function cameraRay(ndcX, ndcY, { position, target, fovDeg, aspect }) {
  const forward = normalize(sub(target, position));
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const halfH = Math.tan((fovDeg * DEG) / 2);
  const halfW = halfH * aspect;
  const direction = normalize({
    x: forward.x + right.x * ndcX * halfW + up.x * ndcY * halfH,
    y: forward.y + right.y * ndcX * halfW + up.y * ndcY * halfH,
    z: forward.z + right.z * ndcX * halfW + up.z * ndcY * halfH,
  });
  return { origin: { ...position }, direction };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
