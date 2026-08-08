export function normalizeSeed(seed) {
  const numeric = Number(seed);
  if (!Number.isFinite(numeric)) return 0x51f15e5d;
  return Math.trunc(numeric) >>> 0;
}

export function createRng(seed) {
  let value = normalizeSeed(seed);
  return function random() {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng, maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('maxExclusive must be a positive integer');
  }
  return Math.floor(rng() * maxExclusive);
}

export function shuffled(values, rng) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomInt(rng, index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
