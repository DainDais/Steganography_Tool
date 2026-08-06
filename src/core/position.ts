// Payload bits are scattered across carrier positions in an order derived
// from the password. Without a password the order is sequential; with one,
// the same password always reproduces the same permutation so the decoder
// can walk the positions back in step with the encoder.

// Derive a 32-bit seed from the password (FNV-1a hash).
function seedFromPassword(password: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < password.length; i++) {
    hash ^= password.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Deterministic PRNG (mulberry32): same seed yields the same sequence.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function selectPositions(count: number, password?: string): number[] {
  const positions = Array.from({ length: count }, (_, i) => i);

  if (!password) {
    return positions;
  }

  // Fisher-Yates shuffle driven by the password-seeded PRNG.
  const random = mulberry32(seedFromPassword(password));
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  return positions;
}
