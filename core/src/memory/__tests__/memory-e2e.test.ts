/**
 * memory 案例库端到端功能验证（PRD memory-案例参考 v0.7 验收）：
 * 真实 buildNovelAgent 装配 + 真实 AgentLoop + 脚本化 provider，在临时 workspace
 * 跑通全链路——纪元注入 → 入库（写后校验修复环）→ preset 硬闸 → version 自愈通知。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNovelAgent } from "../../runtime/agent/NovelAgent.js";
import { InMemoryNovelStore } from "../../novel/index.js";
import { MEMORY_NUDGE_FULL, MEMORY_NUDGE_DELTA } from "../../runtime/nudge/definitions/memory.js";
import { FULL_TEXT_OF } from "../../runtime/nudge/definitions/project-stage.js";
import type { Provider, ProviderCall, LLMessage, NovelHandle, ToolCall } from "../../index.js";

// ── 脚本化 provider：按序出应答，记录每次收到的 messages ──

type ScriptResult = {
  finishReason: "stop" | "tool_call";
  message: { role: "assistant"; content?: string; toolCalls?: ToolCall[] };
};

function scriptedProvider(script: ScriptResult[]) {
  const calls: LLMessage[][] = [];
  let i = 0;
  const provider: Provider = {
    call: async (req: ProviderCall) => {
      calls.push(req.messages);
      return script[Math.min(i++, script.length - 1)]!;
    },
    getModelInfo: (model: string) => ({
      model,
      supportsTemperature: true,
      thinkingMode: "none" as const,
      contextWindowTokens: 128_000,
    }),
  };
  return { provider, calls };
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ScriptResult {
  return {
    finishReason: "tool_call",
    // content 空串对齐真实 provider 形状（压缩度量器按非空 content 计数）
    message: { role: "assistant", content: "", toolCalls: [{ id, name, args: JSON.stringify(args) }] },
  };
}

const stop = (content: string): ScriptResult => ({
  finishReason: "stop",
  message: { role: "assistant", content },
});

/** 全部 provider 可见文本拼一行（存在性断言用） */
function visibleText(messages: readonly LLMessage[]): string {
  return messages
    .map((m) => {
      const content = (m as { content?: unknown }).content;
      return typeof content === "string" ? content : "";
    })
    .join("\n");
}

/** 找包含 needle 的那条消息原文（单条结果断言用——历史里可能残留旧告警） */
function messageOf(messages: readonly LLMessage[], needle: string): string | undefined {
  for (const m of messages) {
    const content = (m as { content?: unknown }).content;
    if (typeof content === "string" && content.includes(needle)) {
      return content;
    }
  }
  return undefined;
}

const COMBAT_FILE = `kind: prose
name: 战斗
desc: 短兵相接的近身打斗与攻防节奏段落
updated: 2026-08-18
entries:
  - id: "001"
    source: paste
    added: 2026-08-18
    text: |
      三段轻功掠过檐角,风声在耳边收紧。
`;

const INDEX_V1 = `version: 1
prose:
  - name: 战斗
    desc: 短兵相接的近身打斗与攻防节奏段落
    path: .novel/references/prose/combat.yaml
`;

// ── e2e ──

describe("memory 案例库 e2e（真实装配全链路）", () => {
  it("纪元注入 → 入库写后校验 → preset 硬闸 → version 自愈通知", async () => {
    const ws = mkdtempSync(join(tmpdir(), "mem-e2e-"));
    const store = new InMemoryNovelStore();
    const handle = {
      query: (q: unknown) => store.query(q as never),
      mutate: (m: unknown) => store.mutate(m as never),
    } as unknown as NovelHandle;

    const { provider, calls } = scriptedProvider([
      stop("好的"), // run1:空库首应答
      toolCall("t1", "Write", { file_path: ".novel/references/prose/combat.yaml", content: COMBAT_FILE }),
      toolCall("t2", "Write", { file_path: "MEMORY.yaml", content: INDEX_V1 }),
      toolCall("t3", "Write", { file_path: ".novel/preset/story/x.yaml", content: "kind: story" }),
      stop("完成"), // run2 结束
      stop("好的"), // run3:自愈触发
    ]);

    const loop = buildNovelAgent({
      workspace: ws,
      provider,
      handle,
      conversationId: "conv-e2e",
      requestApproval: (async () => ({ kind: "approve" })) as never,
    });

    const internals = () =>
      (loop as unknown as {
        context: {
          runs: Array<{ messages: Array<{ role: string; content?: string; nudge?: string }> }>;
          systemPrompt: string;
        };
      }).context;
    const nudgeMessages = (mark: string) =>
      internals().runs.flatMap((r) => r.messages).filter((m) => m.nudge === mark);

    // run1:空库 → 纪元首 run 注入目录全文（含入库提示）
    await loop.run("你好", { sampling: { model: "gpt-5" } });
    const full1 = nudgeMessages(MEMORY_NUDGE_FULL);
    expect(full1.length).toBe(1);
    expect(full1[0]!.content).toContain("尚无任何案例");
    // system prompt 常驻段含记忆偏好案例库规范（novel.memory）
    expect(internals().systemPrompt).toContain("记忆偏好案例库");
    // 工作流文案接入：正文/大纲工作流各含 memory 指引
    expect(FULL_TEXT_OF.write_prose).toContain("<memory>");
    expect(FULL_TEXT_OF.expand_outline).toContain("story 池");

    // run2:入库三连——先案例文件（目录缺失 → 孤儿警告修复环）→ 再目录（干净）→ preset 硬闸
    await loop.run("存个案例", { sampling: { model: "gpt-5" } });
    // call#2 收到 t1 结果：案例文件写入成功但带孤儿警告（目录还没写——修复环演示）
    expect(visibleText(calls[2]!)).toContain("已写入 .novel/references/prose/combat.yaml");
    expect(visibleText(calls[2]!)).toContain("动态编译校验未通过");
    expect(visibleText(calls[2]!)).toContain("孤儿文件");
    // call#3 收到 t2 结果：目录写入后全树一致 → 该条结果本身无校验告警
    const indexResult = messageOf(calls[3]!, "已写入 MEMORY.yaml");
    expect(indexResult).toBeDefined();
    expect(indexResult!).not.toContain("动态编译校验未通过");
    // call#4 收到 t3 结果:preset 硬闸拒绝
    expect(visibleText(calls[4]!)).toContain("预设只读");
    // 文件真实落盘
    expect(readFileSync(join(ws, "MEMORY.yaml"), "utf8")).toContain("version: 1");
    expect(readFileSync(join(ws, ".novel", "references", "prose", "combat.yaml"), "utf8")).toContain(
      "kind: prose",
    );

    // run3:内容已变但 version 未加（模拟 agent 忘 bump）→ nudge 自愈 +1 并发变更通知
    await loop.run("继续", { sampling: { model: "gpt-5" } });
    const delta = nudgeMessages(MEMORY_NUDGE_DELTA);
    expect(delta.length).toBe(1);
    expect(delta[0]!.content).toContain("已更新至 v2"); // 自愈:1 → 2
    expect(delta[0]!.content).toContain("+prose:战斗"); // delta 含 ±类目名
    // 磁盘被自愈写回
    expect(readFileSync(join(ws, "MEMORY.yaml"), "utf8")).toMatch(/version: 2/);
    // 纪元内不重发全文（full 仍只有 run1 那份）
    expect(nudgeMessages(MEMORY_NUDGE_FULL).length).toBe(1);
  });
});
