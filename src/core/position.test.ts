import { describe, it, expect } from "vitest";
import { selectPositions } from "./position";

describe("position selection", () => {
  it("returns sequential order with no password", () => {
    expect(selectPositions(5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("is deterministic for the same password", () => {
    const a = selectPositions(100, "hunter2");
    const b = selectPositions(100, "hunter2");
    expect(a).toEqual(b);
  });

  it("produces different orders for different passwords", () => {
    const a = selectPositions(100, "hunter2");
    const b = selectPositions(100, "correcthorse");
    expect(a).not.toEqual(b);
  });

  it("uses every position exactly once", () => {
    const result = selectPositions(50, "hunter2");
    expect(result.length).toBe(50);
    expect(new Set(result).size).toBe(50);
    expect([...result].sort((x, y) => x - y)).toEqual(
      Array.from({ length: 50 }, (_, i) => i)
    );
  });

  it("actually scrambles the order", () => {
    const result = selectPositions(100, "hunter2");
    const sequential = Array.from({ length: 100 }, (_, i) => i);
    expect(result).not.toEqual(sequential);
  });
});