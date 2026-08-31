import { describe, it, expect } from "vitest";
import { createLocalEmbedder, localEmbedderFromEnv, LOCAL_EMBEDDING_DEFAULT_MODEL } from "../LocalEmbedder.js";

describe("LocalEmbedder（不触网：构造惰性 + env 解析）", () => {
  it("构造零成本（不 import transformers）；未启用 env 返回 undefined", async () => {
    const embedder = createLocalEmbedder();
    expect(embedder.modelId).toBe(`local:${LOCAL_EMBEDDING_DEFAULT_MODEL}`);
    // 空输入不触发模型加载
    expect(await embedder.embed([])).toEqual([]);
    expect(
      localEmbedderFromEnv({ NOVEL_MEMORY_LOCAL_EMBEDDINGS: "" }),
    ).toBeUndefined();
    expect(
      localEmbedderFromEnv({ NOVEL_MEMORY_LOCAL_EMBEDDINGS: "0" }),
    ).toBeUndefined();
  });

  it("env 解析：开启开关 + 镜像 + 模型覆盖 + 缓存目录", () => {
    const options = localEmbedderFromEnv(
      {
        NOVEL_MEMORY_LOCAL_EMBEDDINGS: "1",
        NOVEL_MEMORY_HF_MIRROR: "https://hf-mirror.com/",
        NOVEL_MEMORY_EMBEDDING_MODEL: "Xenova/bge-m3",
        NOVEL_MEMORY_EMBEDDING_CACHE: "D:/cache/models",
      },
      { cacheRoot: "D:/default/models" },
    );
    expect(options).toEqual({
      model: "Xenova/bge-m3",
      mirror: "https://hf-mirror.com/",
      cacheRoot: "D:/cache/models",
    });
    // 缺省：cacheRoot 回落 defaults
    const fallback = localEmbedderFromEnv({ NOVEL_MEMORY_LOCAL_EMBEDDINGS: "true" }, { cacheRoot: "D:/d" });
    expect(fallback?.cacheRoot).toBe("D:/d");
    expect(fallback?.model).toBeUndefined();
    expect(fallback?.mirror).toBeUndefined();
  });

  it("加载失败永久禁用：首次失败后 embed 恒抛错（不重试不触网）", async () => {
    const embedder = createLocalEmbedder({ model: "definitely/not-a-model", mirror: "http://127.0.0.1:1" });
    await expect(embedder.embed(["x"])).rejects.toThrow();
    await expect(embedder.embed(["y"])).rejects.toThrow(/disabled/);
  });
});
