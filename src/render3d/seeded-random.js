// Small seeded random number generator, so generated scenery and art look
// the same on every load. Returns numbers in [0, 1).

export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Random numbers for per-frame effects (xorshift32). Its state lives in a
// typed array and it does integer maths only. random() returns a number in
// [0, 1); random.fill(out) fills a Float64Array with them, which per-frame
// code uses so that no fresh number has to be returned (and boxed by the
// JS engine) for every particle.
export function effectRandom(seed) {
  const state = new Uint32Array([seed >>> 0 || 1]);
  const step = () => {
    let s = state[0];
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    state[0] = s;
  };
  const random = () => {
    step();
    return state[0] / 4294967296;
  };
  random.fill = (out) => {
    for (let i = 0; i < out.length; i++) {
      step();
      out[i] = state[0] / 4294967296;
    }
    return out;
  };
  return random;
}
