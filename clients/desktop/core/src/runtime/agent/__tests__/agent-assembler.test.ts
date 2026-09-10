import { describe, it, expect } from "vitest";
import { AgentAssembler } from "../AgentAssembler.js";
import {
  AgentDefinition,
  AgentToolPolicy,
  AgentDelegationPolicy,
  AgentCommunicationPolicy,
} from "../AgentDefinition.js";
import {
  PromptRecipe,
  PromptSectionItem,
  InlinePromptItem,
} from "../../prompt/PromptRecipe.js";
import { PromptSectionRegistry } from "../../prompt/PromptSectionRegistry.js";
import type { PromptSection } from "../../prompt/PromptSection.js";
import { ToolGroupManifest } from "../../tool/ToolGroupManifest.js";
import type { ToolDef } from "../../tool/ToolDef.js";
import type { ContextNudgePolicy } from "../../nudge/ContextNudgePolicy.js";

function staticSection(id: string, version = "1.0.0"): PromptSection {
  return {
    kind: "static",
    id,
    version,
    label: `Label ${id}`,
    render: () => `${id}@${version}`,
  };
}

function dynamicSection(id: string): PromptSection {
  return {
    kind: "dynamic",
    id,
    version: "1.0.0",
    label: `Label ${id}`,
    renderDynamic: () => id,
  };
}

function makeTool(name: string): ToolDef {
  return { name, version: "1", handler: { execute: async () => name } };
}

const registry = new PromptSectionRegistry([
  staticSection("novel.identity"),
  staticSection("novel.system"),
  staticSection("novel.doing-tasks"),
  staticSection("novel.actions"),
  staticSection("core.runtime.protocol"),
  staticSection("novel.identity", "1.1.0"),
  dynamicSection("tool.guidance"),
]);

const toolCatalog: ReadonlyMap<string, ToolGroupManifest> = new Map([
  [
    "runtime.files",
    new ToolGroupManifest({
      id: "runtime.files",
      version: "1.0.0",
      label: "Runtime Files",
      tools: ["Read", "Glob", "Write", "Edit"],
    }),
  ],
  [
    "novel.characters",
    new ToolGroupManifest({
      id: "novel.characters",
      version: "1.0.0",
      label: "Novel Characters",
      tools: ["CharacterRead", "CharacterWrite", "CharacterEdit"],
    }),
  ],
  [
    "novel.delete",
    new ToolGroupManifest({
      id: "novel.delete",
      version: "1.0.0",
      label: "Novel Delete",
      tools: ["NovelDelete"],
    }),
  ],
]);

const resolveToolGroup = (manifest: ToolGroupManifest): ToolDef[] =>
  manifest.tools.map((name) => makeTool(name));

function makeAssembler(overrides: {
  definition?: AgentDefinition;
  nudgeCatalog?: ReadonlyMap<string, () => ContextNudgePolicy>;
} = {}) {
  const definition =
    overrides.definition ??
    new AgentDefinition({
      agentType: "novel",
      definitionVersion: "1.0.0",
      label: "Novel Agent",
      description: "desc",
      promptRecipe: new PromptRecipe([
        new PromptSectionItem("novel.identity"),
        new PromptSectionItem("novel.doing-tasks"),
        new PromptSectionItem("core.runtime.protocol"),
        new PromptSectionItem("tool.guidance"),
      ]),
      tools: new AgentToolPolicy({ groupIds: ["runtime.files", "novel.delete"] }),
      delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
      communication: new AgentCommunicationPolicy("standalone"),
      runtimePolicyId: "default",
      nudgeEnablement: { enabled: ["todo_idle"] },
    });
  return new AgentAssembler({
    definition,
    sectionRegistry: registry,
    toolGroupCatalog: toolCatalog,
    resolveToolGroup,
    nudgeCatalog: overrides.nudgeCatalog,
  });
}

describe("AgentAssembler", () => {
  it("resolveRecipe：按 recipe 序解析 + 未指定版本取最新版", () => {
    const sections = makeAssembler().resolveRecipe();
    expect(sections.map((s) => s.id)).toEqual([
      "novel.identity",
      "novel.doing-tasks",
      "core.runtime.protocol",
      "tool.guidance",
    ]);
    // identity 未指定版本 → 最新版 1.1.0
    expect(sections[0].version).toBe("1.1.0");
    expect(sections[0].kind).toBe("static");
    expect(sections[3].kind).toBe("dynamic");
  });

  it("resolveRecipe：static 出现在 dynamic 之后报错", () => {
    const bad = new AgentAssembler({
      definition: new AgentDefinition({
        agentType: "novel",
        definitionVersion: "1.0.0",
        label: "Novel Agent",
        description: "desc",
        promptRecipe: new PromptRecipe([
          new PromptSectionItem("tool.guidance"),
          new PromptSectionItem("novel.identity"),
        ]),
        tools: new AgentToolPolicy({ groupIds: ["runtime.files"] }),
        delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
        communication: new AgentCommunicationPolicy("standalone"),
        runtimePolicyId: "default",
      }),
      sectionRegistry: registry,
      toolGroupCatalog: toolCatalog,
      resolveToolGroup,
    });
    expect(() => bad.resolveRecipe()).toThrow(/static.*after dynamic/);
  });

  it("resolveRecipe：内联条目包装为静态段（唯一 id + 恒定渲染）", () => {
    const assembler = new AgentAssembler({
      definition: new AgentDefinition({
        agentType: "novel",
        definitionVersion: "1.0.0",
        label: "Novel Agent",
        description: "desc",
        promptRecipe: new PromptRecipe([
          new InlinePromptItem("内联提示"),
          new PromptSectionItem("tool.guidance"),
        ]),
        tools: new AgentToolPolicy({ groupIds: ["runtime.files"] }),
        delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
        communication: new AgentCommunicationPolicy("standalone"),
        runtimePolicyId: "default",
      }),
      sectionRegistry: registry,
      toolGroupCatalog: toolCatalog,
      resolveToolGroup,
    });
    const sections = assembler.resolveRecipe();
    expect(sections[0].kind).toBe("static");
    expect((sections[0] as { render: (ctx: unknown) => string }).render({} as never)).toBe(
      "内联提示",
    );
  });

  it("resolveTools：组序展开 + allow/deny 过滤 + 未知组报错", () => {
    const assembler = makeAssembler();
    // runtime.files(4) + novel.delete(1)
    expect(assembler.resolveTools().map((t) => t.name)).toEqual([
      "Read",
      "Glob",
      "Write",
      "Edit",
      "NovelDelete",
    ]);
    // allow 过滤
    const allowOnly = new AgentAssembler({
      definition: new AgentDefinition({
        agentType: "novel",
        definitionVersion: "1.0.0",
        label: "Novel Agent",
        description: "desc",
        promptRecipe: new PromptRecipe([new PromptSectionItem("novel.identity")]),
        tools: new AgentToolPolicy({ groupIds: ["runtime.files"], allow: ["Read", "Write"] }),
        delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
        communication: new AgentCommunicationPolicy("standalone"),
        runtimePolicyId: "default",
      }),
      sectionRegistry: registry,
      toolGroupCatalog: toolCatalog,
      resolveToolGroup,
    });
    expect(allowOnly.resolveTools().map((t) => t.name)).toEqual(["Read", "Write"]);
    // 未知组
    const unknownGroup = new AgentAssembler({
      definition: new AgentDefinition({
        agentType: "novel",
        definitionVersion: "1.0.0",
        label: "Novel Agent",
        description: "desc",
        promptRecipe: new PromptRecipe([new PromptSectionItem("novel.identity")]),
        tools: new AgentToolPolicy({ groupIds: ["novel.missing"] }),
        delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
        communication: new AgentCommunicationPolicy("standalone"),
        runtimePolicyId: "default",
      }),
      sectionRegistry: registry,
      toolGroupCatalog: toolCatalog,
      resolveToolGroup,
    });
    expect(() => unknownGroup.resolveTools()).toThrow(/unknown/);
  });

  it("resolveNudges：enabled ∩ 实现目录，按声明序实例化", () => {
    const calls: string[] = [];
    const catalog: ReadonlyMap<string, () => ContextNudgePolicy> = new Map([
      [
        "todo_idle",
        () => {
          calls.push("todo_idle");
          return { persistentNudgeIfNeeded: () => false, transientNudgeIfNeeded: () => false };
        },
      ],
      [
        "compose_mode",
        () => {
          calls.push("compose_mode");
          return { persistentNudgeIfNeeded: () => false, transientNudgeIfNeeded: () => false };
        },
      ],
    ]);
    const assembler = makeAssembler({ nudgeCatalog: catalog });
    // enabled 只有 todo_idle：compose_mode 不在启用集，不实例化
    expect(assembler.resolveNudges()).toHaveLength(1);
    expect(calls).toEqual(["todo_idle"]);
  });

  it("assemble：完整能力组装（段序 + 工具 + nudge）", () => {
    const cap = makeAssembler().assemble();
    expect(cap.systemSections.map((s) => s.id)).toEqual([
      "novel.identity",
      "novel.doing-tasks",
      "core.runtime.protocol",
      "tool.guidance",
    ]);
    expect(cap.toolDefs).toHaveLength(5);
    expect(cap.nudgePolicies).toHaveLength(0); // 无 catalog → 过滤为空
    expect(cap.compactPolicies).toHaveLength(0);
  });
});
