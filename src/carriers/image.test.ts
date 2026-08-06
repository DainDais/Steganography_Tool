import { describe, it, expect } from "vitest";
import { encodeImage, decodeImage, capacity, type RasterImage } from "./image";

function makeImage(width: number, height: number): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    data[i] = i % 4 === 3 ? 255 : (i * 37) % 256;
  }
  return { width, height, data };
}

const secret = new TextEncoder().encode("meet me at midnight");

describe("image carrier", () => {
  it("reports capacity correctly", () => {
    expect(capacity(makeImage(10, 10))).toBe(Math.floor(300 / 8) - 10);
  });

  it("round-trips a payload with no password", async () => {
    const stego = await encodeImage(makeImage(40, 40), secret);
    const out = await decodeImage(stego);
    expect(new TextDecoder().decode(out)).toBe("meet me at midnight");
  });

  it("round-trips a payload with a password", async () => {
    const stego = await encodeImage(makeImage(40, 40), secret, {
      password: "hunter2",
    });
    const out = await decodeImage(stego, { password: "hunter2" });
    expect(new TextDecoder().decode(out)).toBe("meet me at midnight");
  });

  it("fails with the wrong password", async () => {
    const stego = await encodeImage(makeImage(40, 40), secret, {
      password: "hunter2",
    });
    await expect(decodeImage(stego, { password: "wrong" })).rejects.toThrow();
  });

  it("reports no payload in a clean image", async () => {
    await expect(decodeImage(makeImage(40, 40))).rejects.toThrow();
  });

  it("rejects a payload that is too large", async () => {
    const big = new Uint8Array(5000);
    await expect(encodeImage(makeImage(10, 10), big)).rejects.toThrow();
  });

  it("does not modify the original image", async () => {
    const original = makeImage(40, 40);
    const copy = new Uint8ClampedArray(original.data);
    await encodeImage(original, secret);
    expect(original.data).toEqual(copy);
  });

  it("changes each channel by at most 1", async () => {
    const original = makeImage(40, 40);
    const stego = await encodeImage(original, secret);
    for (let i = 0; i < original.data.length; i++) {
      expect(Math.abs(stego.data[i] - original.data[i])).toBeLessThanOrEqual(1);
    }
  });

  it("never touches the alpha channel", async () => {
    const original = makeImage(40, 40);
    const stego = await encodeImage(original, secret);
    for (let i = 3; i < original.data.length; i += 4) {
      expect(stego.data[i]).toBe(original.data[i]);
    }
  });
});