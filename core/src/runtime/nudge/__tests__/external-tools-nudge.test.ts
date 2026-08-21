import { describe, it, expect } from "vitest";
import {
  ExternalToolsNudgePolicy,
  EXTERNAL_TOOLS_NUDGE_MARK,
  renderExternalToolsText,
} from "../definitions/external-tools.js";
import { DeferredToolRegistry } from "../../tool/deferred/DeferredToolRegistry.js";
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunProgress } from "../../loop/types.js";
import type { LLMessage } from "../../provider/types.js";
import type { ToolDef } from "../../tool/ToolDef.js";

function makeTool(name: string): ToolDef {
  return { name, version: "1.0.0", handler: { execute: async () => "ok" } };
}

/** LoopContext 替身：可调 generation / runs 消息、记录 append */
function makeLoop(state: { generation: number; runsMessages: LLMessage[][] }) {
  const appended: LLMessage[] = [];
  const loop = {
    appendRunMessages: (messages: LLMessage[]) => {
      appended.push(...messages);
    },
    get compactionGeneration() {
      return state.generation;
    },
    get messages() {
      return state.runsMessages.flat();
    },
    get runs() {
      return state.runsMessages.map((messages) => ({ messages }));
    },
  } as unknown as LoopContext;
  return { loop, appended };
}

function makeRun(curTurn = 0): RunProgress {
  return { curTurn, maxTurn: 100, toolsLastTurn: new Map() };
}

describe("ExternalToolsNudgePolicy", () => {
  it("空注册表：no-op，不注入", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new ExternalToolsNudgePolicy({ registry: new DeferredToolRegistry() });
    expect(policy.persistentNudgeIfNeeded(loop, makeRun())).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it("非空注册表首调用：注入公告（名单 + 两步流程 + 纪律），带 nudge 标记", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new ExternalToolsNudgePolicy({
      registry: new DeferredToolRegistry([
        makeTool("mcp__slack__send"),
        makeTool("mcp__notion__query"),
      ]),
    });
    expect(policy.persistentNudgeIfNeeded(loop, makeRun())).toBe(true);
    expect(appended).toHaveLength(1);
    const message = appended[0]!;
    expect(message.role).toBe("system");
    expect((message as { nudge?: string }).nudge).toBe(EXTERNAL_TOOLS_NUDGE_MARK);
    const text = message.content;
    expect(text).toContain("mcp__slack__send");
    expect(text).toContain("mcp__notion__query");
    expect(text).toContain("SearchExtraTools");
    expect(text).toContain("ExecuteExtraTool");
    expect(text).toContain("不能直接调用");
  });

  it("curTurn>0 不注入", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new ExternalToolsNudgePolicy({
      registry: new DeferredToolRegistry([makeTool("mcp__a__x")]),
    });
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(1))).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it("同纪元每 run 至多一次：后续调用不重注", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new ExternalToolsNudgePolicy({
      registry: new DeferredToolRegistry([makeTool("mcp__a__x")]),
    });
    expect(policy.persistentNudgeIfNeeded(loop, makeRun())).toBe(true);
    expect(policy.persistentNudgeIfNeeded(loop, makeRun())).toBe(false);
    expect(policy.persistentNudgeIfNeeded(loop, makeRun())).toBe(false);
    expect(appended).toHaveLength(1);
  });

  it("压缩纪元变化：重注入", () => {
    const state = { generation: 0, runsMessages: [] as LLMessage[][] };
    const { loop, appended } = makeLoop(state);
    const policy = new ExternalToolsNudgePolicy({
      registry: new DeferredToolRegistry([makeTool("mcp__a__x")]),
    });
    expect(policy.persistentNudgeIfNeeded(loop, makeRun())).toBe(true);
    state.generation = 1; // 压缩后清扫标记消息 → 纪元重置
    state.runsMessages = [[]]; // 清扫后消息被移除
    expect(policy.persistentNudgeIfNeeded(loop, makeRun())).toBe(true);
    expect(appended).toHaveLength(2);
  });

  it("clear 兜底：messages 非空→空 视同纪元重置，重注入", () => {
    const state = { generation: 0, runsMessages: [["user 消息" as unknown as LLMessage]] };
    const { loop, appended } = makeLoop(state);
    const policy = new ExternalToolsNudgePolicy({
      registry: new DeferredToolRegistry([makeTool("mcp__a__x")]),
    });
    expect(policy.persistentNudgeIfNeeded(loop, makeRun())).toBe(true);
    state.runsMessages = [[]];
    expect(policy.persistentNudgeIfNeeded(loop, makeRun())).toBe(true);
    expect(appended).toHaveLength(2);
  });

  it("重启 seed-scan：runs 已有标记消息 → 幂等不重发", () => {
    const state = {
      generation: 0,
      runsMessages: [
        [{ role: "system", content: "旧公告", nudge: EXTERNAL_TOOLS_NUDGE_MARK } as LLMessage],
      ],
    };
    const { loop, appended } = makeLoop(state);
    const policy = new ExternalToolsNudgePolicy({
      registry: new DeferredToolRegistry([makeTool("mcp__a__x")]),
    });
    expect(policy.persistentNudgeIfNeeded(loop, makeRun())).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it("transient 恒 false；renderExternalToolsText 含名单", () => {
    const registry = new DeferredToolRegistry([makeTool("mcp__a__x")]);
    const policy = new ExternalToolsNudgePolicy({ registry });
    expect(policy.transientNudgeIfNeeded({} as never, makeRun(), {} as never)).toBe(false);
    expect(renderExternalToolsText(registry)).toContain("mcp__a__x");
    expect(renderExternalToolsText(registry)).toContain("1 个");
  });
});
