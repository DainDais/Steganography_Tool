import { describe, it, expect } from "vitest";
import { encodeText, decodeText, capacity, stripHidden } from "./text";

const cover =
  "The quick brown fox jumps over the lazy dog. ".repeat(30);

const secret = new TextEncoder().encode("rendezvous at noon");

describe("text carrier", () => {
  it("reports zero capacity for text too short to hold a header", () => {
    expect(capacity("hello world")).toBe(0);
  });

  it("reports usable capacity for long enough text", () => {
    const gaps = cover.length + 1;
    expect(capacity(cover)).toBe(Math.floor(gaps / 8) - 10);
    expect(capacity(cover)).toBeGreaterThan(0);
  });

  it("round-trips a payload with no password", async () => {
    const stego = await encodeText(cover, secret);
    const out = await decodeText(stego);
    expect(new TextDecoder().decode(out)).toBe("rendezvous at noon");
  });

  it("round-trips a payload with a password", async () => {
    const stego = await encodeText(cover, secret, { password: "hunter2" });
    const out = await decodeText(stego, { password: "hunter2" });
    expect(new TextDecoder().decode(out)).toBe("rendezvous at noon");
  });

  it("leaves the visible text unchanged", async () => {
    const stego = await encodeText(cover, secret);
    expect(stripHidden(stego)).toBe(cover);
  });

  it("looks longer than it reads", async () => {
    const stego = await encodeText(cover, secret);
    expect(stego.length).toBeGreaterThan(cover.length);
    expect(stripHidden(stego).length).toBe(cover.length);
  });

  it("fails with the wrong password", async () => {
    const stego = await encodeText(cover, secret, { password: "hunter2" });
    await expect(decodeText(stego, { password: "wrong" })).rejects.toThrow();
  });

  it("reports no payload in ordinary text", async () => {
    await expect(decodeText(cover)).rejects.toThrow();
  });

  it("rejects a payload too large for the cover", async () => {
    const big = new Uint8Array(500);
    await expect(encodeText("short text", big)).rejects.toThrow();
  });

  it("survives emoji in the cover text", async () => {
    const emojiCover = "Hello 👋 world 🌍 this is fine ".repeat(20);
    const stego = await encodeText(emojiCover, secret);
    const out = await decodeText(stego);
    expect(new TextDecoder().decode(out)).toBe("rendezvous at noon");
    expect(stripHidden(stego)).toBe(emojiCover);
  });
});