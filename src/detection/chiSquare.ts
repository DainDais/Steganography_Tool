// Detects LSB embedding by looking for "pairs of values" convergence.
// LSB embedding only ever swaps 2k <-> 2k+1, so the total for each
// pair is preserved while the split between members drifts to 50/50.

export interface DetectionResult {
  score: number;        // 0 = looks clean, 1 = looks embedded
  suspicious: boolean;
  detail: string;
}

// Provisional. exp(-1/2) ~= 0.607 is roughly where fully-embedded data
// lands, so this cutoff needs calibrating against real photographs
// before it means anything. See README limitations.
const THRESHOLD = 0.5;

export function chiSquareLsb(
  data: Uint8ClampedArray,
  channelStride = 4,
  channelsUsed = 3
): DetectionResult {
  const histogram = new Array(256).fill(0);

  for (let i = 0; i < data.length; i += channelStride) {
    for (let c = 0; c < channelsUsed; c++) {
      histogram[data[i + c]]++;
    }
  }

  let chiSquare = 0;
  let degreesOfFreedom = 0;

  for (let k = 0; k < 128; k++) {
    const even = histogram[2 * k];
    const odd = histogram[2 * k + 1];
    const total = even + odd;

    // Skip sparse pairs: chi-square is unreliable with tiny counts.
    if (total < 8) continue;

    const expected = total / 2;
    chiSquare += ((even - expected) ** 2) / expected;
    degreesOfFreedom++;
  }

  if (degreesOfFreedom === 0) {
    return {
      score: 0,
      suspicious: false,
      detail: "Not enough data to analyse",
    };
  }

  // Normalised deviation: near 1 means each pair is close to 50/50,
  // which is the signature of embedding.
  const normalised = chiSquare / degreesOfFreedom;
  const score = Math.exp(-normalised / 2);

  return {
    score,
    suspicious: score > THRESHOLD,
    detail: `chi2/df = ${normalised.toFixed(3)} over ${degreesOfFreedom} pairs`,
  };
}