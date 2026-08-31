import { describe, it, expect } from "vitest";
import { bm25Rank, containsCjk, tokenize } from "../MemorySearch.js";

describe("tokenize（CJK bigram + 拉丁词）", () => {
  it("CJK 连续段提取 bigram；单字段退 unigram", () => {
    expect(tokenize("打斗场面")).toEqual(["打斗", "斗场", "场面"]);
    expect(tokenize("人")).toEqual(["人"]);
  });

  it("拉丁词小写化、连字符词拆分；混合文本（拉丁在前 CJK 在后）", () => {
    expect(tokenize("Pov-Preference")).toEqual(["pov", "preference"]);
    expect(tokenize("打斗场面 pov-preference")).toEqual([
      "pov",
      "preference",
      "打斗",
      "斗场",
      "场面",
    ]);
  });

  it("CJK 标点为分隔符；空白不产 token", () => {
    expect(tokenize("人称：第一人称，基调。")).toEqual(["人称", "第一", "一人", "人称", "基调"]);
    expect(tokenize("   ")).toEqual([]);
  });

  it("containsCjk 快速判定", () => {
    expect(containsCjk("abc")).toBe(false);
    expect(containsCjk("打斗")).toBe(true);
  });
});

describe("bm25Rank（字段加权 + IDF 区分度）", () => {
  const docs = [
    { key: "battle-style", name: "battle-style", description: "打斗场面短句为主" },
    { key: "pov-preference", name: "pov-preference", description: "人称偏好第一人称" },
    { key: "pacing-note", name: "pacing-note", description: "节奏偏好快节奏打斗" },
  ];

  it("CJK bigram 查询召回（描述含目标词的条目排前）", () => {
    const ranked = bm25Rank(docs, "打斗场面");
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]?.key).toBe("battle-style");
  });

  it("名称命中权重×2：名称匹配排在仅描述匹配之前", () => {
    const ranked = bm25Rank(docs, "pacing");
    expect(ranked[0]?.key).toBe("pacing-note");
  });

  it("罕见词 IDF 区分度：稀有词只召回唯一含词条目", () => {
    const rankedCommon = bm25Rank(docs, "打斗");
    const rankedRare = bm25Rank(docs, "短句");
    expect(rankedCommon[0]?.key).toBe("battle-style");
    expect(rankedRare[0]?.key).toBe("battle-style");
    // 打斗 在 2 条出现（battle-style/pacing-note）；短句 仅 battle-style——稀有词收窄召回
    expect(rankedCommon.some((r) => r.key === "pacing-note")).toBe(true);
    expect(rankedRare.some((r) => r.key === "pacing-note")).toBe(false);
  });

  it("同分按 key 字典序（确定性）", () => {
    const twins = [
      { key: "b-note", name: "x", description: "同文" },
      { key: "a-note", name: "x", description: "同文" },
    ];
    const ranked = bm25Rank(twins, "同文");
    expect(ranked.map((r) => r.key)).toEqual(["a-note", "b-note"]);
  });

  it("无匹配/空查询返回空", () => {
    expect(bm25Rank(docs, "量子纠缠")).toEqual([]);
    expect(bm25Rank(docs, "  ")).toEqual([]);
    expect(bm25Rank([], "x")).toEqual([]);
  });
});
