import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEMORY_EMBEDDINGS_FILE,
  cosineSimilarity,
  createLlmReranker,
  hybridSearch,
  rrfFuse,
} from "../MemoryHybrid.js";
import type { Embedder } from "../LocalEmbedder.js";
import type { Reranker } from "../MemoryHybrid.js";
import { searchMemoryTopics, writeMemoryTopic } from "../MemoryStore.js";
import type { MemoryTopic } from "../MemoryStore.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "memory-hybrid-"));
});

/** 确定性 stub embedder：以文本首字符的码点做二维向量（同首字符 → 同向量高相似） */
function stubEmbedder(): Embedder {
  return {
    modelId: "stub:v1",
    embed: async (texts) =>
      texts.map((t) => {
        const code = t.codePointAt(0) ?? 0;
        return [Math.sin(code), Math.cos(code)];
      }),
  };
}

async function seedTopics(): Promise<void> {
  await writeMemoryTopic(
    workspace,
    { name: "battle-style", type: "feedback", description: "打斗场面短句为主", content: "打斗短句。" },
    "c#1",
  );
  await writeMemoryTopic(
    workspace,
    { name: "pov-preference", type: "feedback", description: "人称偏好第一人称", content: "第一人称。" },
    "c#2",
  );
  await writeMemoryTopic(
    workspace,
    { name: "update-rhythm", type: "project", description: "每周双更固定节奏", content: "周二周五。" },
    "c#3",
  );
}

describe("MemoryHybrid", () => {
  it("cosine：同向=1、正交=0、反向=-1", () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("RRF 融合：两路都靠前的条目排前；单路条目按名次；同分 name 字典序", () => {
    const fused = rrfFuse(["a", "b", "c"], ["b", "a", "d"]);
    expect(fused[0]?.name).toBe("a"); // 两路均第 1/2
    expect(fused[1]?.name).toBe("b");
    // 单路条目在有双路条目之后
    const names = fused.map((f) => f.name);
    expect(names.indexOf("c")).toBeGreaterThan(names.indexOf("a"));
    expect(names).toContain("d");
  });

  it("纯词法降级：embedder 缺席 → BM25 序（不建向量缓存）", async () => {
    await seedTopics();
    const results = await hybridSearch(workspace, await readTopics(), "打斗", 5);
    expect(results[0]?.name).toBe("battle-style");
    const cacheRaw = await readFile(join(workspace, "memory", MEMORY_EMBEDDINGS_FILE), "utf8").catch(
      () => "missing",
    );
    expect(cacheRaw).toBe("missing");
  });

  it("混合路径：向量缓存生成 + 失效（description 变更重嵌）+ 剪枝（删除条目）", async () => {
    await seedTopics();
    const embedder = stubEmbedder();
    await hybridSearch(workspace, await readTopics(), "打斗", 5, { embedder });
    const cachePath = join(workspace, "memory", MEMORY_EMBEDDINGS_FILE);
    const cache1 = JSON.parse(await readFile(cachePath, "utf8")) as {
      modelId: string;
      entries: Record<string, { hash: string }>;
    };
    expect(cache1.modelId).toBe("stub:v1");
    expect(Object.keys(cache1.entries).sort()).toEqual(["battle-style", "pov-preference", "update-rhythm"]);
    // 内容变更 → 指纹失效重嵌（hash 变化）
    await writeMemoryTopic(
      workspace,
      { name: "battle-style", type: "feedback", description: "打斗场面短句为主（修订）", content: "打斗短句。" },
      "c#4",
    );
    let embedCalls = 0;
    const counting: Embedder = {
      modelId: "stub:v1",
      embed: async (texts) => {
        embedCalls += texts.length;
        return stubEmbedder().embed(texts);
      },
    };
    await hybridSearch(workspace, await readTopics(), "打斗", 5, { embedder: counting });
    expect(embedCalls).toBe(2); // 1 条重嵌 + 1 条查询向量
    const cache2 = JSON.parse(await readFile(cachePath, "utf8")) as typeof cache1;
    expect(cache2.entries["battle-style"]?.hash).not.toBe(cache1.entries["battle-style"]?.hash);
  });

  it("rerank：候选重排生效；失败/超时静默回退融合序", async () => {
    await seedTopics();
    const topics = await readTopics();
    // stub 向量把 pov-preference 排前（"人"首字符），rerank 把 battle-style 拉回第一
    const reranker: Reranker = async (_query, candidates) =>
      candidates.map((c) => ({ name: c.name, score: c.name === "battle-style" ? 10 : 1 }));
    const reranked = await hybridSearch(workspace, topics, "打斗 人称", 3, {
      embedder: stubEmbedder(),
      reranker,
    });
    expect(reranked[0]?.name).toBe("battle-style");
    // 失败回退：reranker 抛错 → 融合序不丢结果
    const failing: Reranker = async () => {
      throw new Error("rerank down");
    };
    const fallback = await hybridSearch(workspace, topics, "打斗 人称", 3, {
      embedder: stubEmbedder(),
      reranker: failing,
    });
    expect(fallback.length).toBe(2); // 打斗/人称 各命中一条；失败回退不丢结果
    expect(fallback.map((f) => f.name)).toContain("battle-style");
  });

  it("嵌入失败：embedder 抛错 → 纯词法降级不抛错", async () => {
    await seedTopics();
    const broken: Embedder = {
      modelId: "broken:v1",
      embed: async () => {
        throw new Error("embed down");
      },
    };
    const results = await hybridSearch(workspace, await readTopics(), "打斗", 5, { embedder: broken });
    expect(results[0]?.name).toBe("battle-style");
  });

  it("createLlmReranker：JSON 解析（含前后噪声容错）+ 分数夹取", async () => {
    const reranker = createLlmReranker(async () =>
      '好的，结果如下：[{"name":"a","score":99},{"name":"b","score":-5},{"name":"c"}]',
    );
    const ranked = await reranker("q", [
      { name: "a", description: "d", type: "feedback", status: "active" },
      { name: "b", description: "d", type: "feedback", status: "active" },
      { name: "c", description: "d", type: "feedback", status: "active" },
    ]);
    expect(ranked).toEqual([
      { name: "a", score: 10 },
      { name: "b", score: 0 },
    ]);
    const noJson = createLlmReranker(async () => "没有数组");
    await expect(noJson("q", [])).rejects.toThrow("无 JSON 数组");
  });

  it("换 modelId → 缓存整体失效重嵌", async () => {
    await seedTopics();
    const topics = await readTopics();
    await hybridSearch(workspace, topics, "打斗", 5, { embedder: stubEmbedder() });
    let calls = 0;
    const v2: Embedder = {
      modelId: "stub:v2",
      embed: async (texts) => {
        calls += texts.length;
        return stubEmbedder().embed(texts);
      },
    };
    await hybridSearch(workspace, topics, "打斗", 5, { embedder: v2 });
    expect(calls).toBe(topics.length + 1); // 全量重嵌 + 查询
  });

  it("层级语义锁死（D10）：无选项=纯 BM25 兜底；传 embedder=委托混合；reranker 单独可用", async () => {
    await seedTopics();
    // 兜底层：不传 hybrid → 纯 BM25（不建缓存、无 rerank 调用）
    const bare = await searchMemoryTopics(workspace, "打斗", 5);
    expect(bare[0]?.name).toBe("battle-style");
    // 混合层：经 searchMemoryTopics 委托 hybridSearch（embedder 生效且产缓存）
    const hybrid = await searchMemoryTopics(workspace, "打斗", 5, { embedder: stubEmbedder() });
    expect(hybrid[0]?.name).toBe("battle-style");
    const cache = JSON.parse(
      await readFile(join(workspace, "memory", MEMORY_EMBEDDINGS_FILE), "utf8"),
    ) as { modelId: string };
    expect(cache.modelId).toBe("stub:v1");
    // rerank 单独挂（无 embedder）：BM25 序上 rerank 仍生效（BM25+rerank 退化层）
    const reranker: Reranker = async (_q, candidates) =>
      candidates.map((c) => ({ name: c.name, score: c.name === "update-rhythm" ? 10 : 0 }));
    const rerankedOnly = await searchMemoryTopics(workspace, "节奏 打斗 更新", 3, { reranker });
    expect(rerankedOnly.some((r) => r.name === "update-rhythm")).toBe(true);
  });
});

/** 读回主题（复用 MemoryStore 读盘路径） */
async function readTopics(): Promise<MemoryTopic[]> {
  const { readMemoryIndexForInjection } = await import("../MemoryStore.js");
  const snapshot = await readMemoryIndexForInjection(workspace);
  const { readMemoryTopic } = await import("../MemoryStore.js");
  const topics: MemoryTopic[] = [];
  for (const entry of snapshot?.entries ?? []) {
    const topic = await readMemoryTopic(workspace, entry.name);
    if (topic !== undefined) topics.push(topic);
  }
  return topics;
}
