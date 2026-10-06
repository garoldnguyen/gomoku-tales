// Ring waves of the skill effects: crisp pixel dots spreading in a circle
// over the field (effects3d.js draws them as one Points draw call). A cast
// ring spreads from a skill's target plot in the colour of the character
// that used it, Hiss sends wavy jade sound rings across the field, and the
// winning plants each send one ring in the winner's colour. Rings play on
// every quality level: they are dots, not particles, and are not capped
// by the level's particle cap.
//
// Pure: no DOM or Three.js, so it runs under node --test. A ring record is
// made once (createRings) and reused; startRing fills one in when events
// arrive, and the per-frame functions (ringDotsInto, stepRings) only read
// and write numbers.

const TWO_PI = Math.PI * 2;
const WOBBLE_SPEED = 0.008; // radians per ms the wobble runs round a ring

function newRing() {
  return {
    active: false,
    start: 0.5, // ms: the event time; the ring leaves `delay` later
    delay: 0.5,
    ms: 0.5, // how long it spreads
    x: 0.5, // world centre on the board
    z: 0.5,
    y: 0.5, // world height of the dots
    from: 0.5, // world radius at the start and at the end
    to: 0.5,
    dots: 0,
    color: 0,
    wobble: 0.5, // world units of the sound wave wobble, 0 for a plain ring
    waves: 0,
    alpha: 0.5, // written by ringDotsInto: this frame's opacity
  };
}

// `slots` reusable ring records.
export function createRings(slots) {
  const rings = [];
  for (let i = 0; i < slots; i++) rings.push(newRing());
  return rings;
}

// Starts a ring at `time` in a free record, or in the one that started
// first when every record plays. p: { x, z, y, from, to, ms, dots, color,
// delay, wobble, waves } (delay, wobble and waves default to 0). Returns
// the record.
export function startRing(rings, p, time) {
  let ring = null;
  for (const r of rings) {
    if (!r.active) {
      ring = r;
      break;
    }
    if (!ring || r.start + r.delay < ring.start + ring.delay) ring = r;
  }
  ring.active = true;
  ring.start = time;
  ring.delay = p.delay ?? 0;
  ring.ms = p.ms;
  ring.x = p.x;
  ring.z = p.z;
  ring.y = p.y ?? 0.04;
  ring.from = p.from;
  ring.to = p.to;
  ring.dots = p.dots;
  ring.color = p.color;
  ring.wobble = p.wobble ?? 0;
  ring.waves = p.waves ?? 0;
  ring.alpha = 0;
  return ring;
}

// How far a ring is along its spread at `time`: below 0 before it leaves,
// 1 and more once it is gone.
export function ringProgress(ring, time) {
  return (time - ring.start - ring.delay) / ring.ms;
}

// The ring's radius at progress t (0 to 1): fast at first, slowing down.
export function ringRadius(ring, t) {
  const u = Math.min(1, Math.max(0, t));
  return ring.from + (ring.to - ring.from) * (1 - (1 - u) * (1 - u));
}

// The ring's opacity at progress t: full as it leaves, fading to nothing.
export function ringAlpha(t) {
  if (!(t >= 0) || t >= 1) return 0;
  const left = 1 - t;
  return left * Math.sqrt(left);
}

// Writes the ring's dots at `time` into xyz (x, y, z per dot, relative to
// nothing: world positions) and its opacity into ring.alpha. Returns how
// many dots it wrote: 0 before the ring leaves and after it is gone.
export function ringDotsInto(ring, time, xyz) {
  const t = ringProgress(ring, time);
  if (!ring.active || t < 0 || t >= 1) {
    ring.alpha = 0;
    return 0;
  }
  ring.alpha = ringAlpha(t);
  const radius = ringRadius(ring, t);
  const spin = (time - ring.start) * WOBBLE_SPEED;
  const n = Math.min(ring.dots, Math.floor(xyz.length / 3));
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * TWO_PI;
    const r = radius + ring.wobble * Math.sin(ring.waves * angle + spin);
    xyz[i * 3] = ring.x + Math.cos(angle) * r;
    xyz[i * 3 + 1] = ring.y;
    xyz[i * 3 + 2] = ring.z + Math.sin(angle) * r;
  }
  return n;
}

// Ends the rings that are gone by `time`.
export function stepRings(rings, time) {
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    if (ring.active && ringProgress(ring, time) >= 1) ring.active = false;
  }
}

// Stops every ring at once (a new game).
export function clearRings(rings) {
  for (let i = 0; i < rings.length; i++) rings[i].active = false;
}
