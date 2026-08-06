import { describe, it, expect } from "vitest";
import { chiSquareLsb } from "./chiSquare";
import { samplePairAnalysis } from "./sampleAnalysis";
import { encodeImage, type RasterImage } from "../carriers/image";

// A smooth gradient, similar in character to a natural photograph:
// neighbouring pixels are close in value, LSBs are far from random.
function makeNaturalImage(width: number, height: number): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const base = Math.floor((x / width) * 200) + Math.floor((y / height) * 40);
      data[i] = base;
      data[i + 1] = base;
      data[i + 2] = base;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const filler = new Uint8Array(2000);
crypto.getRandomValues(filler);

describe("steganalysis", () => {
  it("scores a clean image low", () => {
    const clean = makeNaturalImage(100, 100);
    const result = chiSquareLsb(clean.data);
    expect(result.suspicious).toBe(false);
  });

  it("scores higher as the embedding rate rises", async () => {
    const clean = makeNaturalImage(100, 100);

    const light = new Uint8Array(200);
    const heavy = new Uint8Array(3600);
    crypto.getRandomValues(light);
    crypto.getRandomValues(heavy);

    const lightStego = await encodeImage(clean, light);
    const heavyStego = await encodeImage(clean, heavy);

    const cleanScore = chiSquareLsb(clean.data).score;
    const lightScore = chiSquareLsb(lightStego.data).score;
    const heavyScore = chiSquareLsb(heavyStego.data).score;

    expect(lightScore).toBeGreaterThan(cleanScore);
    expect(heavyScore).toBeGreaterThan(lightScore);
  });

  it("separates clean from embedded", async () => {
    const clean = makeNaturalImage(100, 100);
    const stego = await encodeImage(clean, filler);
    expect(chiSquareLsb(stego.data).score).toBeGreaterThan(
      chiSquareLsb(clean.data).score
    );
  });

  // Sample pair analysis is a weaker signal than chi-square, especially
  // on synthetic gradients. We assert only that it does not point the
  // wrong way, rather than claiming more than the technique delivers.
  it("sample pair analysis is not fooled in the wrong direction", async () => {
    const clean = makeNaturalImage(100, 100);
    const stego = await encodeImage(clean, filler);
    expect(samplePairAnalysis(stego.data).score).toBeGreaterThanOrEqual(
      samplePairAnalysis(clean.data).score
    );
  });

  it("is less confident about a small payload", async () => {
    const tiny = new Uint8Array(20);
    crypto.getRandomValues(tiny);
    const clean = makeNaturalImage(100, 100);
    const heavy = await encodeImage(clean, filler);
    const light = await encodeImage(clean, tiny);
    expect(chiSquareLsb(light.data).score).toBeLessThan(
      chiSquareLsb(heavy.data).score
    );
  });
});