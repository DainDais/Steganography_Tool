// A second, independent signal: sample pair analysis. Compares how
// often neighbouring channel values differ only in their LSB.

import type { DetectionResult } from "./chiSquare";

export function samplePairAnalysis(
  data: Uint8ClampedArray,
  channelStride = 4,
  channelsUsed = 3
): DetectionResult {
  let pairsDifferingOnlyInLsb = 0;
  let pairsExamined = 0;

  for (let i = 0; i + channelStride < data.length; i += channelStride) {
    for (let c = 0; c < channelsUsed; c++) {
      const a = data[i + c];
      const b = data[i + channelStride + c];

      if (a >> 1 === b >> 1) {
        pairsExamined++;
        if (a !== b) pairsDifferingOnlyInLsb++;
      }
    }
  }

  if (pairsExamined < 100) {
    return { score: 0, suspicious: false, detail: "Too few pairs to analyse" };
  }

  // Clean images: neighbours in the same PoV pair are usually identical.
  // Embedded images: the split approaches 50/50. We measure how close
  // the observed ratio is to 0.5 rather than scaling it linearly, so the
  // score does not saturate at the top of its range.
  const ratio = pairsDifferingOnlyInLsb / pairsExamined;
  const score = Math.max(0, 1 - Math.abs(ratio - 0.5) * 2);

  return {
    score,
    suspicious: score > 0.6,
    detail: `${(ratio * 100).toFixed(1)}% of matched pairs differ only in LSB`,
  };
}