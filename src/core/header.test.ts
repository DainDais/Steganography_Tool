import { describe, it, expect } from "vitest";
import {
  MAGIC,
  VERSION,
  HEADER_SIZE,
  serializeHeader,
  deserializeHeader,
} from "./header";

describe("header serialization", () => {
  it("produces exactly HEADER_SIZE bytes", () => {
    const bytes = serializeHeader({
      magic: MAGIC,
      version: VERSION,
      encrypted: false,
      length: 42,
    });
    expect(bytes.length).toBe(HEADER_SIZE);
  });

  it("round-trips all fields correctly", () => {
    const original = {
      magic: MAGIC,
      version: VERSION,
      encrypted: true,
      length: 1234,
    };
    const restored = deserializeHeader(serializeHeader(original));
    expect(restored).toEqual(original);
  });

  it("rejects data with a wrong magic number", () => {
    const junk = new Uint8Array(HEADER_SIZE);
    expect(() => deserializeHeader(junk)).toThrow();
  });

  it("rejects data that is too short", () => {
    const tooShort = new Uint8Array(3);
    expect(() => deserializeHeader(tooShort)).toThrow();
  });
});