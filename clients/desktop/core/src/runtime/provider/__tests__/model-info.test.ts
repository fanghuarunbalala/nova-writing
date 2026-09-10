import { describe, it, expect } from "vitest";
import { ModelInfoRegistry } from "../model-info.js";

describe("ModelInfoRegistry 默认推断", () => {
  it("claude-opus-5 → adaptive-effort，无温度（新模型已移除）", () => {
    const info = new ModelInfoRegistry().getModelInfo("claude-opus-5");
    expect(info.thinkingMode).toBe("adaptive-effort");
    expect(info.supportsTemperature).toBe(false);
  });

  it("claude-opus-4-6 → adaptive-effort，支持温度", () => {
    const info = new ModelInfoRegistry().getModelInfo("claude-opus-4-6");
    expect(info.thinkingMode).toBe("adaptive-effort");
    expect(info.supportsTemperature).toBe(true);
  });

  it("deepseek-v4-flash → reasoning-effort，effort 档位仅 low/high/max", () => {
    const info = new ModelInfoRegistry().getModelInfo("deepseek-v4-flash");
    expect(info.thinkingMode).toBe("reasoning-effort");
    expect(info.effortLevels).toEqual(["low", "high", "max"]);
  });

  it("gpt-5 → reasoning-effort，支持温度", () => {
    const info = new ModelInfoRegistry().getModelInfo("gpt-5");
    expect(info.thinkingMode).toBe("reasoning-effort");
    expect(info.supportsTemperature).toBe(true);
  });

  it("未知模型 → none 保守默认，支持温度", () => {
    const info = new ModelInfoRegistry().getModelInfo("some-local-model");
    expect(info.thinkingMode).toBe("none");
    expect(info.supportsTemperature).toBe(true);
  });

  it("register 覆盖默认推断", () => {
    const registry = new ModelInfoRegistry();
    registry.register("claude-opus-5", {
      model: "claude-opus-5",
      supportsTemperature: true,
      thinkingMode: "none",
    });
    const info = registry.getModelInfo("claude-opus-5");
    expect(info.supportsTemperature).toBe(true);
    expect(info.thinkingMode).toBe("none");
  });
});
