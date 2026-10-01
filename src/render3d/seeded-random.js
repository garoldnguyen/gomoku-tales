// Small seeded random number generator, so generated scenery and art look
// the same on every load. Returns numbers in [0, 1).

export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
