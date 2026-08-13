import { describe, it, expect } from "vitest";
import { applyToolPolicy } from "../toolPolicy.js";
import { ToolError } from "../errors.js";
import type { ToolDef } from "../ToolDef.js";

function pool(names: readonly string[]): ToolDef[] {
  return names.map((name) => ({ name, version: "1.0.0", handler: { execute: async () => "" } }));
}

describe("applyToolPolicy", () => {
  it("无 policy → 全池保序", () => {
    const defs = pool(["Read", "Glob", "Write"]);
    expect(applyToolPolicy(defs)).toEqual(defs);
    expect(applyToolPolicy(defs, {})).toEqual(defs);
  });

  it("allow 子集保池序", () => {
    const defs = pool(["Read", "Glob", "CharacterRead", "Write"]);
    expect(applyToolPolicy(defs, { allow: ["CharacterRead", "Read"] }).map((t) => t.name)).toEqual(
      ["Read", "CharacterRead"],
    );
  });

  it("deny 差集", () => {
    const defs = pool(["Read", "Glob", "Write"]);
    expect(applyToolPolicy(defs, { deny: ["Write"] }).map((t) => t.name)).toEqual(["Read", "Glob"]);
  });

  it("allow ∩ deny 组合", () => {
    const defs = pool(["Read", "Glob", "Write"]);
    expect(
      applyToolPolicy(defs, { allow: ["Read", "Write"], deny: ["Write"] }).map((t) => t.name),
    ).toEqual(["Read"]);
  });

  it("allow 名单不在池 → TOOL_POLICY_INVALID", () => {
    const defs = pool(["Read"]);
    try {
      applyToolPolicy(defs, { allow: ["Ghost"] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_POLICY_INVALID");
      expect((err as ToolError).toolName).toBe("Ghost");
      expect((err as Error).message).toContain("白名单未注册: Ghost");
    }
  });

  it("deny 名单不在池 → TOOL_POLICY_INVALID", () => {
    const defs = pool(["Read"]);
    try {
      applyToolPolicy(defs, { deny: ["Ghost"] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_POLICY_INVALID");
      expect((err as Error).message).toContain("黑名单未注册: Ghost");
    }
  });

  it("allow=[] → 空工具集", () => {
    const defs = pool(["Read"]);
    expect(applyToolPolicy(defs, { allow: [] })).toEqual([]);
  });
});
