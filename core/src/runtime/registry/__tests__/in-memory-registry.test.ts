import { describe, it, expect } from "vitest";
import { InMemoryRegistry } from "../InMemoryRegistry.js";
import type { PromptSection } from "../../prompt/PromptSection.js";
import type { ToolDef } from "../../tool/ToolDef.js";
import type { ContextNudgePolicy } from "../../nudge/ContextNudgePolicy.js";
import type { ContextCompactPolicy } from "../../compact/ContextCompactPolicy.js";

const section: PromptSection = {
  kind: "static",
  id: "p1",
  version: "1.0.0",
  label: "P1",
  render: () => "system",
};
const tool: ToolDef = { name: "read", version: "1", handler: { execute: async () => "" } };
const nudge: ContextNudgePolicy = {
  persistentNudgeIfNeeded: () => false,
  transientNudgeIfNeeded: () => false,
};
const compact: ContextCompactPolicy = {
  shouldCompact: () => false,
  compact: () => false,
};

describe("InMemoryRegistry", () => {
  it("注册/获取 agent，version 缺失报错", () => {
    const r = new InMemoryRegistry();
    r.registerAgent({ agentType: "writer", agentVersion: "1" });
    expect(r.getAgent("writer", "1").agentType).toBe("writer");
    expect(() => r.getAgent("writer", "2")).toThrow();
  });

  it("注册/获取 tool/prompt/nudge/compact（按 version 区分）", () => {
    const r = new InMemoryRegistry();
    r.registerTool(tool);
    expect(r.getTool("read", "1")).toBe(tool);
    expect(r.getTool("read", "2")).toBeUndefined();
    r.registerPrompt(section, "p1", "1");
    expect(r.getPrompt("p1", "1")).toBe(section);
    r.registerNudge(nudge, "n1", "1");
    expect(r.getNudge("n1", "1")).toBe(nudge);
    r.registerCompact(compact, "c1", "1");
    expect(r.getCompact("c1", "1")).toBe(compact);
  });

  it("buildCapability 按 agent 关联组装", () => {
    const r = new InMemoryRegistry();
    r.registerAgent({
      agentType: "writer",
      agentVersion: "1",
      toolNames: ["read"],
      promptIds: ["p1"],
      nudgeIds: ["n1"],
      compactIds: ["c1"],
    });
    r.registerTool(tool);
    r.registerPrompt(section, "p1", "1");
    r.registerNudge(nudge, "n1", "1");
    r.registerCompact(compact, "c1", "1");
    const cap = r.buildCapability("writer", "1");
    expect(cap.toolDefs).toHaveLength(1);
    expect(cap.systemSections).toHaveLength(1);
    expect(cap.nudgePolicies).toHaveLength(1);
    expect(cap.compactPolicies).toHaveLength(1);
  });

  it("buildCapability 未注册关联项跳过", () => {
    const r = new InMemoryRegistry();
    r.registerAgent({ agentType: "writer", agentVersion: "1", toolNames: ["missing"] });
    const cap = r.buildCapability("writer", "1");
    expect(cap.toolDefs).toHaveLength(0);
  });
});
