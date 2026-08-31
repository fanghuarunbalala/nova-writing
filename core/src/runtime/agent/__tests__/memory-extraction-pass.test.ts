/**
 * 提取整理 pass 密闭测试（PRD memory-两层记忆 §6.3 / §7）：stub provider 脚本化
 * 模型行为（先 MemoryWrite 后结束），断言：写入过同一校验通道（source=来源会话
 * 与最大 run 序号）、工具面受限（无 Write/Edit/MemoryForget）、超时 cancel 放行
 * 不抛错、serializeRuns 截断保最新。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryExtractionPass, serializeRunsForExtraction } from "../MemoryExtractionPass.js";
import { readMemoryTopic } from "../../../memory/MemoryStore.js";
import type { Provider } from "../../provider/Provider.js";
import type { ProviderCall, ProviderResult } from "../../provider/types.js";
import type { RunContext } from "../../loop/types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "memory-pass-"));
});

function result(
  finishReason: ProviderResult["finishReason"],
  content: string,
  toolCalls?: ProviderResult["message"]["toolCalls"],
): ProviderResult {
  return {
    finishReason,
    message: { role: "assistant", content, ...(toolCalls ? { toolCalls } : {}) },
  };
}

function scriptedProvider(results: ProviderResult[]): Provider {
  let i = 0;
  return {
    call: async () => results[i++] ?? result("stop", "done"),
  };
}

function makeRun(seq: number, ...messages: { role: "user" | "assistant"; content: string }[]): RunContext {
  const msgs = messages as RunContext["messages"];
  return {
    seq,
    messages: msgs,
    ts: "t",
    appendRunMessages: (m) => {
      msgs.push(...m);
    },
  };
}

const STATIC_LAYERS = async () => ["# 全局\n- 不要 BE"] as const;

describe("MemoryExtractionPass", () => {
  it("脚本化提取：模型 MemoryWrite 落盘、source=来源会话#最大 run 序号、工具面受限", async () => {
    const provider = scriptedProvider([
      result("tool_call", "提取中", [
        {
          id: "t1",
          name: "MemoryWrite",
          args: JSON.stringify({
            name: "battle-style",
            type: "feedback",
            description: "打斗场面短句为主",
            content: "## 规则/事实\n\n打斗短句。\n\n## Why\n\n作者要求。",
          }),
        },
      ]),
      result("stop", "完成"),
    ]);
    const pass = createMemoryExtractionPass({
      workspace,
      provider,
      conversationId: "conv_7",
      staticLayerTexts: STATIC_LAYERS,
    });
    await pass.run({ model: "m" }, [
      makeRun(1, { role: "user", content: "以后打斗都写短句" }),
      makeRun(9, { role: "assistant", content: "好的" }),
    ]);
    const topic = await readMemoryTopic(workspace, "battle-style");
    expect(topic?.source).toBe("conv_7#9"); // 来源会话 + 最大 run 序号（非写入会话）
  });

  it("skip 生效：与静态层重叠的提取被拒（同一四道校验通道）", async () => {
    const provider = scriptedProvider([
      result("tool_call", "", [
        {
          id: "t1",
          name: "MemoryWrite",
          args: JSON.stringify({
            name: "be-taboo",
            type: "feedback",
            description: "不要 BE",
            content: "## 规则/事实\n\n结局不 BE。",
          }),
        },
      ]),
      result("stop", ""),
    ]);
    const pass = createMemoryExtractionPass({
      workspace,
      provider,
      conversationId: "conv_7",
      staticLayerTexts: STATIC_LAYERS,
    });
    await pass.run({ model: "m" }, [makeRun(1, { role: "user", content: "记住不要 BE" })]);
    expect(await readMemoryTopic(workspace, "be-taboo")).toBeUndefined();
  });

  it("超时放行：pass 恒不抛错（provider 悬挂时压缩主线不被阻塞）", async () => {
    const hanging: Provider = {
      call: () => new Promise<ProviderResult>(() => {}),
    };
    const pass = createMemoryExtractionPass({
      workspace,
      provider: hanging,
      conversationId: "conv_7",
      staticLayerTexts: STATIC_LAYERS,
      timeoutMs: 50,
    });
    await expect(
      pass.run({ model: "m" }, [makeRun(1, { role: "user", content: "x" })]),
    ).resolves.toBeUndefined();
  });

  it("空 runs：直接返回不发起模型调用", async () => {
    let calls = 0;
    const counting: Provider = {
      call: async () => {
        calls++;
        return result("stop", "");
      },
    };
    const pass = createMemoryExtractionPass({
      workspace,
      provider: counting,
      conversationId: "c",
      staticLayerTexts: STATIC_LAYERS,
    });
    await pass.run({ model: "m" }, []);
    expect(calls).toBe(0);
  });

  it("serializeRunsForExtraction：user/assistant 正文保留、tool 结果只留标记、超量从最新端保留", () => {
    const long = "x".repeat(3000);
    const runs = [
      makeRun(1, { role: "user", content: "最老的内容" }),
      makeRun(2, { role: "assistant", content: long }),
    ];
    const text = serializeRunsForExtraction(runs);
    expect(text).toContain("【run 1·user】最老的内容");
    expect(text.length).toBeLessThanOrEqual(60_000 + 20);
    // 单消息截断
    expect(text).not.toContain(long);
    // 最新端优先：构造超量 runs，断言保住最新、丢掉最老
    const many = Array.from({ length: 100 }, (_, i) =>
      makeRun(i + 1, { role: "user", content: `消息-${String(i).padStart(3, "0")}-${"y".repeat(900)}` }),
    );
    const big = serializeRunsForExtraction(many);
    expect(big).toContain("消息-099");
    expect(big).not.toContain("消息-000");
    expect(big.startsWith("（更早内容已截断）")).toBe(true);
  });
});
