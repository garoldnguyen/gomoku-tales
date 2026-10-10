// A fixed-size pool of effect particles (docs/art-direction-hd2d.md section
// G). Every field lives in a typed array allocated once, live particles
// are packed at the front (0 to count - 1) and a dead one is swapped with
// the last live one, so spawning and stepping never allocate. When the pool
// is full a new particle is dropped. No DOM or Three.js, so it runs under
// node --test; src/render3d/effects3d.js copies the live particles into a
// Three.js Points buffer every frame.
//
// Two kinds of motion:
//   MOTION_FALL    flies with a velocity, gravity and drag, and bounces
//                  softly on the board (y = FLOOR_Y)
//   MOTION_SPIRAL  circles a centre on the ground while it rises and its
//                  circle widens (tornado columns, the Wind Dash swirl)

export const MOTION_FALL = 0;
export const MOTION_SPIRAL = 1;

export const SHAPE_SQUARE = 0; // a solid pixel square (dust, rubble, wind)
export const SHAPE_PLUS = 1; // a plus-shaped twinkle (sparkles)

export const FLOOR_Y = 0.02; // just above the board top
const BOUNCE = 0.3; // share of the downward speed kept after hitting the floor
const FLOOR_FRICTION = 0.5; // share of the sideways speed kept after hitting the floor

// Spawn parameters, reused for every particle: set the fields, then call
// spawnFall(params) or spawnSpiral(params). One object keeps spawning free
// of allocations; a dozen separate number arguments would each be boxed by
// the JS engine. life is in seconds; size and grow (size added over the
// whole life) in world units; color is 0xRRGGBB (sRGB).
export function createSpawnParams() {
  // Fractions, so the engine stores every field as a float from the start.
  return {
    x: 0.5, y: 0.5, z: 0.5, vx: 0.5, vy: 0.5, vz: 0.5, gravity: 0.5, drag: 0.5,
    radius: 0.5, angle: 0.5, spin: 0.5, rise: 0.5, widen: 0.5,
    life: 0.5, size: 0.5, grow: 0.5, color: 0xffffff, alpha: 0.5, shape: SHAPE_SQUARE,
  };
}

export function createParticlePool(capacity) {
  const f32 = () => new Float32Array(capacity);
  const x = f32();
  const y = f32();
  const z = f32();
  const vx = f32(); // MOTION_SPIRAL: vy is the rise speed
  const vy = f32();
  const vz = f32();
  const gravity = f32();
  const drag = f32();
  const cx = f32();
  const cz = f32();
  const angle = f32();
  const spin = f32();
  const radius = f32();
  const radiusGrow = f32();
  const age = f32();
  const life = f32();
  const size = f32();
  const sizeGrow = f32();
  const r = f32();
  const g = f32();
  const b = f32();
  const alpha = f32();
  const motion = new Uint8Array(capacity);
  const shape = new Uint8Array(capacity);

  const pool = {
    capacity,
    // Live particles allowed at once (the quality level's particle cap),
    // at most capacity. Lowering it keeps the live ones; new ones wait.
    limit: capacity,
    count: 0,
    x, y, z, vx, vy, vz, gravity, drag, cx, cz, angle, spin, radius, radiusGrow,
    age, life, size, sizeGrow, r, g, b, alpha, motion, shape,
  };

  // Takes the next free slot and sets what every particle has. Returns its
  // index, or -1 when the pool is full.
  function take(kind, lifeS, sizeWorld, grow, color, opacity, look) {
    if (pool.count >= capacity || pool.count >= pool.limit) return -1;
    const i = pool.count++;
    motion[i] = kind;
    shape[i] = look;
    age[i] = 0;
    life[i] = lifeS > 0 ? lifeS : 0.001;
    size[i] = sizeWorld;
    sizeGrow[i] = grow;
    r[i] = ((color >> 16) & 0xff) / 255;
    g[i] = ((color >> 8) & 0xff) / 255;
    b[i] = (color & 0xff) / 255;
    alpha[i] = opacity;
    return i;
  }

  function copy(from, to) {
    x[to] = x[from];
    y[to] = y[from];
    z[to] = z[from];
    vx[to] = vx[from];
    vy[to] = vy[from];
    vz[to] = vz[from];
    gravity[to] = gravity[from];
    drag[to] = drag[from];
    cx[to] = cx[from];
    cz[to] = cz[from];
    angle[to] = angle[from];
    spin[to] = spin[from];
    radius[to] = radius[from];
    radiusGrow[to] = radiusGrow[from];
    age[to] = age[from];
    life[to] = life[from];
    size[to] = size[from];
    sizeGrow[to] = sizeGrow[from];
    r[to] = r[from];
    g[to] = g[from];
    b[to] = b[from];
    alpha[to] = alpha[from];
    motion[to] = motion[from];
    shape[to] = shape[from];
  }

  // A falling particle at (p.x, p.y, p.z) with velocity (p.vx, p.vy, p.vz)
  // in world units per second, slowed by p.gravity and p.drag, from a
  // spawn parameter object (createSpawnParams).
  pool.spawnFall = (p) => {
    const i = take(MOTION_FALL, p.life, p.size, p.grow, p.color, p.alpha, p.shape);
    if (i < 0) return -1;
    x[i] = p.x;
    y[i] = p.y;
    z[i] = p.z;
    vx[i] = p.vx;
    vy[i] = p.vy;
    vz[i] = p.vz;
    gravity[i] = p.gravity;
    drag[i] = p.drag;
    return i;
  };

  // A particle circling the ground point (p.x, p.z) at p.radius, starting
  // at p.angle and height p.y. p.spin is in radians per second, p.rise and
  // p.widen (how fast the circle grows) in world units per second.
  pool.spawnSpiral = (p) => {
    const i = take(MOTION_SPIRAL, p.life, p.size, p.grow, p.color, p.alpha, p.shape);
    if (i < 0) return -1;
    cx[i] = p.x;
    cz[i] = p.z;
    radius[i] = p.radius;
    angle[i] = p.angle;
    spin[i] = p.spin;
    vy[i] = p.rise;
    radiusGrow[i] = p.widen;
    y[i] = p.y;
    x[i] = p.x + Math.cos(p.angle) * p.radius;
    z[i] = p.z + Math.sin(p.angle) * p.radius;
    return i;
  };

  // Advances every particle by frame.dtS seconds and removes the ones
  // whose life is over. (The time step comes in an object so it is not
  // boxed as a loose number every frame.)
  pool.step = (frame) => {
    const { dtS } = frame;
    let i = 0;
    while (i < pool.count) {
      age[i] += dtS;
      if (age[i] >= life[i]) {
        pool.count--;
        if (i !== pool.count) copy(pool.count, i);
        continue; // the particle moved into slot i has not been stepped yet
      }
      if (motion[i] === MOTION_SPIRAL) {
        angle[i] += spin[i] * dtS;
        radius[i] = Math.max(0, radius[i] + radiusGrow[i] * dtS);
        y[i] += vy[i] * dtS;
        x[i] = cx[i] + Math.cos(angle[i]) * radius[i];
        z[i] = cz[i] + Math.sin(angle[i]) * radius[i];
      } else {
        const keep = Math.max(0, 1 - drag[i] * dtS);
        vx[i] *= keep;
        vz[i] *= keep;
        vy[i] = (vy[i] - gravity[i] * dtS) * keep;
        x[i] += vx[i] * dtS;
        y[i] += vy[i] * dtS;
        z[i] += vz[i] * dtS;
        if (y[i] < FLOOR_Y) {
          y[i] = FLOOR_Y;
          if (vy[i] < 0) vy[i] = -vy[i] * BOUNCE;
          vx[i] *= FLOOR_FRICTION;
          vz[i] *= FLOOR_FRICTION;
        }
      }
      i++;
    }
  };

  pool.clear = () => {
    pool.count = 0;
  };

  // Removes the particles circling the ground point (x, z) at once, and no
  // others: the swirl of a Tornado Zone that the viewer may no longer see
  // must not linger. (Float32 storage, so the point is matched within a
  // thousandth of a world unit.)
  pool.removeSpiralAt = (px, pz) => {
    for (let i = pool.count - 1; i >= 0; i--) {
      if (motion[i] !== MOTION_SPIRAL || Math.abs(cx[i] - px) > 0.001 || Math.abs(cz[i] - pz) > 0.001) continue;
      pool.count--;
      if (i !== pool.count) copy(pool.count, i);
    }
  };

  // How see-through particle i is now: it fades in quickly, holds and fades
  // out over the last third of its life.
  pool.alphaAt = (i) => {
    const t = age[i] / life[i];
    return alpha[i] * Math.min(1, t * 8) * Math.min(1, (1 - t) * 3);
  };

  pool.sizeAt = (i) => size[i] + sizeGrow[i] * (age[i] / life[i]);

  return pool;
}

// How many particles to spawn for `base` at the highest level when the
// quality level scales particles by `scale`: never fewer than one, except
// none at all for a scale of 0.
export function scaledCount(base, scale) {
  return scale > 0 ? Math.max(1, Math.round(base * scale)) : 0;
}

// Continuous emission at ratePerS particles a second: returns how many
// whole particles to spawn over dtS seconds and keeps the fraction left
// over in emitter.carry for the next frame, so slow rates still emit.
export function emit(emitter, ratePerS, dtS) {
  const total = Math.max(0, ratePerS * dtS) + emitter.carry;
  const count = Math.floor(total);
  emitter.carry = total - count;
  return count;
}
