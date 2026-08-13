import { describe, it, expect } from "vitest";
import { InMemoryRegistry } from "../InMemoryRegistry.js";
import { ToolError } from "../../tool/errors.js";
import type { PromptSection } from "../../prompt/PromptSection.js";
import type { ToolDef } from "../../tool/ToolDef.js";
import type { ContextNudgePolicy } from "../../nudge/ContextNudgePolicy.js";
import type { ContextCompactPolicy } from "../../compact/ContextCompactPolicy.js";

const section: PromptSection = { kind: "static", render: () => "system" };
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
    r.registerAgent({ agentType: "writer", agentVersion: "1", label: "Writer", description: "测试" });
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

  it("buildCapability 按 agent 关联组装（tools.allow 过滤池）", () => {
    const r = new InMemoryRegistry();
    r.registerAgent({
      agentType: "writer",
      agentVersion: "1",
      label: "Writer",
      description: "测试",
      tools: { allow: ["read"] },
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

  it("buildCapability 无 tools 策略 → 收集全部版本匹配工具", () => {
    const r = new InMemoryRegistry();
    r.registerAgent({ agentType: "writer", agentVersion: "1", label: "Writer", description: "测试" });
    r.registerTool(tool);
    r.registerTool({ name: "glob", version: "1", handler: { execute: async () => "" } });
    r.registerTool({ name: "glob", version: "2", handler: { execute: async () => "" } });
    const cap = r.buildCapability("writer", "1");
    expect(cap.toolDefs.map((t) => t.name)).toEqual(["read", "glob"]);
  });

  it("buildCapability 策略名单未注册 → 抛 TOOL_POLICY_INVALID", () => {
    const r = new InMemoryRegistry();
    r.registerAgent({
      agentType: "writer",
      agentVersion: "1",
      label: "Writer",
      description: "测试",
      tools: { allow: ["missing"] },
    });
    try {
      r.buildCapability("writer", "1");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_POLICY_INVALID");
      expect((err as Error).message).toContain("白名单未注册: missing");
    }
  });

  it("buildCapability 名单项已注册但 version 不匹配 → 池为空抛 TOOL_POLICY_INVALID", () => {
    const r = new InMemoryRegistry();
    r.registerAgent({
      agentType: "writer",
      agentVersion: "1",
      label: "Writer",
      description: "测试",
      tools: { allow: ["read"] },
    });
    r.registerTool({ name: "read", version: "2", handler: { execute: async () => "" } });
    try {
      r.buildCapability("writer", "1");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_POLICY_INVALID");
    }
  });

  it("buildCapability 未注册的 prompt/nudge/compact 关联项静默跳过", () => {
    const r = new InMemoryRegistry();
    r.registerAgent({
      agentType: "writer",
      agentVersion: "1",
      label: "Writer",
      description: "测试",
      promptIds: ["missing-p"],
      nudgeIds: ["missing-n"],
      compactIds: ["missing-c"],
    });
    const cap = r.buildCapability("writer", "1");
    expect(cap.toolDefs).toHaveLength(0);
    expect(cap.systemSections).toHaveLength(0);
    expect(cap.nudgePolicies).toHaveLength(0);
    expect(cap.compactPolicies).toHaveLength(0);
  });
});
