/**
 * P1.0 基建冒烟：确认 vitest + jsdom 环境可用。
 */
import { describe, expect, it } from "vitest";

describe("vitest baseline", () => {
  it("runs in jsdom", () => {
    expect(typeof document).toBe("object");
    expect(typeof window).toBe("object");
  });
});
