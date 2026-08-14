import { describe, it, expect } from "vitest";
import {
  AgentDefinition,
  AgentToolPolicy,
  AgentDelegationPolicy,
  AgentCommunicationPolicy,
  EMPTY_AGENT_NUDGE_ENABLEMENT,
} from "../AgentDefinition.js";
import {
  PromptRecipe,
  PromptSectionItem,
  InlinePromptItem,
} from "../../prompt/PromptRecipe.js";
import { ToolGroupManifest } from "../../tool/ToolGroupManifest.js";

function makeDefinition(overrides: Partial<ConstructorParameters<typeof AgentDefinition>[0]> = {}) {
  return new AgentDefinition({
    agentType: "novel",
    definitionVersion: "1.0.0",
    label: "Novel Agent",
    description: "Collaborates with the user to imagine, plan, and create serialized web novels.",
    promptRecipe: new PromptRecipe([new PromptSectionItem("novel.identity")]),
    tools: new AgentToolPolicy({ groupIds: ["runtime.files"] }),
    delegation: new AgentDelegationPolicy({
      mode: "subagent",
      allowedAgentTypes: ["novel_explorer", "novel_compose"],
    }),
    communication: new AgentCommunicationPolicy("standalone"),
    runtimePolicyId: "default",
    ...overrides,
  });
}

describe("AgentDefinition（值对象体系）", () => {
  it("完整构造：字段捕获 + 冻结 + 缺省空 nudge", () => {
    const def = makeDefinition();
    expect(def.agentType).toBe("novel");
    expect(def.definitionVersion).toBe("1.0.0");
    expect(def.label).toBe("Novel Agent");
    expect(def.promptRecipe.items).toHaveLength(1);
    expect(def.tools.groupIds).toEqual(["runtime.files"]);
    expect(def.delegation.mode).toBe("subagent");
    expect(def.delegation.allowedAgentTypes).toEqual(["novel_explorer", "novel_compose"]);
    expect(def.communication.role).toBe("standalone");
    expect(def.runtimePolicyId).toBe("default");
    expect(def.nudgeEnablement).toBe(EMPTY_AGENT_NUDGE_ENABLEMENT);
    expect(Object.isFrozen(def)).toBe(true);
  });

  it("nudgeEnablement：显式启用逐项唯一，缺省空集", () => {
    const def = makeDefinition({
      nudgeEnablement: { enabled: ["compose_mode", "todo_idle"] },
    });
    expect(def.nudgeEnablement.enabled).toEqual(["compose_mode", "todo_idle"]);
    expect(() =>
      makeDefinition({ nudgeEnablement: { enabled: ["compose_mode", "compose_mode"] } }),
    ).toThrow(/unique/);
  });

  it("校验：非法 agentType / 版本 / 空 label 报错", () => {
    expect(() => makeDefinition({ agentType: "Novel" })).toThrow(/Agent type/);
    expect(() => makeDefinition({ definitionVersion: "1" })).toThrow(/version/);
    expect(() => makeDefinition({ label: "  " })).toThrow(/label/);
  });

  it("校验：非值对象实例（裸对象冒充 recipe/tools）报错", () => {
    expect(() =>
      makeDefinition({ promptRecipe: { items: [] } as never }),
    ).toThrow(/Recipe/);
    expect(() => makeDefinition({ tools: { groupIds: [] } as never })).toThrow(/Tool policy/);
  });

  it("AgentToolPolicy：组清单非空唯一 + allow/deny 可选", () => {
    expect(() => new AgentToolPolicy({ groupIds: [] })).toThrow(/invalid/);
    expect(
      () => new AgentToolPolicy({ groupIds: ["runtime.files", "runtime.files"] }),
    ).toThrow(/unique/);
    const policy = new AgentToolPolicy({
      groupIds: ["runtime.files"],
      allow: ["Read"],
      deny: ["NovelDelete"],
    });
    expect(policy.allow).toEqual(["Read"]);
    expect(policy.deny).toEqual(["NovelDelete"]);
  });

  it("AgentDelegationPolicy：disabled 不允许 agent 类型", () => {
    expect(
      () =>
        new AgentDelegationPolicy({
          mode: "disabled",
          allowedAgentTypes: ["novel_explorer"],
        }),
    ).toThrow(/Disabled/);
  });

  it("快照往返：toSnapshot 结构与原值一致", () => {
    const def = makeDefinition({
      promptRecipe: new PromptRecipe([
        new PromptSectionItem("novel.identity"),
        new PromptSectionItem("core.runtime.protocol", "1.0.0"),
        new InlinePromptItem("内联"),
      ]),
      nudgeEnablement: { enabled: ["todo_idle"] },
    });
    const snapshot = def.toSnapshot();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.agentType).toBe("novel");
    expect(snapshot.promptRecipe.items).toHaveLength(3);
    expect(snapshot.tools.groupIds).toEqual(["runtime.files"]);
    expect(snapshot.delegation.allowedAgentTypes).toEqual(["novel_explorer", "novel_compose"]);
    expect(snapshot.communication.role).toBe("standalone");
    expect(snapshot.nudgeEnablement.enabled).toEqual(["todo_idle"]);
  });

  it("ToolGroupManifest：tools 非空唯一 + 快照", () => {
    const manifest = new ToolGroupManifest({
      id: "runtime.files",
      version: "1.0.0",
      label: "Runtime Files",
      description: "workspace 文件工具",
      tools: ["Read", "Glob", "Write", "Edit"],
    });
    expect(manifest.tools).toEqual(["Read", "Glob", "Write", "Edit"]);
    expect(() =>
      new ToolGroupManifest({
        id: "x.y",
        version: "1.0.0",
        label: "X",
        tools: ["Read", "Read"],
      }),
    ).toThrow(/unique/);
    expect(() =>
      new ToolGroupManifest({ id: "x.y", version: "1.0.0", label: "X", tools: [] }),
    ).toThrow(/invalid/);
    expect(manifest.toSnapshot().schemaVersion).toBe(1);
  });
});
