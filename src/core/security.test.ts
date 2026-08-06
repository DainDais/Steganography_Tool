import { describe, it, expect } from "vitest";
import { encryptPayload, decryptPayload } from "./security";

const message = new TextEncoder().encode("attack at dawn");

describe("payload encryption", () => {
  it("round-trips a message", async () => {
    const encrypted = await encryptPayload(message, "hunter2");
    const decrypted = await decryptPayload(encrypted, "hunter2");
    expect(new TextDecoder().decode(decrypted)).toBe("attack at dawn");
  });

  it("produces different ciphertext each time", async () => {
    const a = await encryptPayload(message, "hunter2");
    const b = await encryptPayload(message, "hunter2");
    expect(a).not.toEqual(b);
  });

  it("does not leak the plaintext", async () => {
    const encrypted = await encryptPayload(message, "hunter2");
    const asText = new TextDecoder().decode(encrypted);
    expect(asText).not.toContain("attack");
  });

  it("rejects the wrong password", async () => {
    const encrypted = await encryptPayload(message, "hunter2");
    await expect(decryptPayload(encrypted, "wrong")).rejects.toThrow();
  });

  it("rejects tampered ciphertext", async () => {
    const encrypted = await encryptPayload(message, "hunter2");
    encrypted[encrypted.length - 1] ^= 0xff;
    await expect(decryptPayload(encrypted, "hunter2")).rejects.toThrow();
  });
});