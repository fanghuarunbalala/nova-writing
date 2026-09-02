import { describe, it, expect } from "vitest";
import {
  PromptRecipe,
  PromptSectionItem,
  InlinePromptItem,
  captureSectionId,
  captureVersion,
} from "../PromptRecipe.js";

describe("PromptRecipe", () => {
  it("有序组装段引用 + 内联条目", () => {
    const recipe = new PromptRecipe([
      new PromptSectionItem("novel.identity"),
      new InlinePromptItem("内联提示"),
      new PromptSectionItem("core.runtime.protocol", "1.0.0"),
    ]);
    expect(recipe.items).toHaveLength(3);
    expect(recipe.items[0]).toBeInstanceOf(PromptSectionItem);
    expect((recipe.items[0] as PromptSectionItem).sectionId).toBe("novel.identity");
    expect(recipe.items[1]).toBeInstanceOf(InlinePromptItem);
    expect(recipe.items[2]).toBeInstanceOf(PromptSectionItem);
  });

  it("段引用 id 唯一（重复报错）", () => {
    expect(
      () =>
        new PromptRecipe([
          new PromptSectionItem("novel.identity"),
          new PromptSectionItem("novel.identity", "1.1.0"),
        ]),
    ).toThrow(/unique/);
  });

  it("空 recipe / 超 64 条目报错", () => {
    expect(() => new PromptRecipe([])).toThrow(/invalid/);
    const items = Array.from({ length: 65 }, (_, i) => new InlinePromptItem(`line ${i}`));
    expect(() => new PromptRecipe(items)).toThrow(/invalid/);
  });

  it("内联条目：空内容 / 超 1024 字符报错", () => {
    expect(() => new InlinePromptItem("  ")).toThrow(/invalid/);
    expect(() => new InlinePromptItem("x".repeat(1025))).toThrow(/invalid/);
    expect(new InlinePromptItem("x".repeat(1024)).content).toHaveLength(1024);
  });

  it("快照往返：toSnapshot 结构完整", () => {
    const recipe = new PromptRecipe([
      new PromptSectionItem("novel.identity"),
      new PromptSectionItem("core.runtime.protocol", "1.0.0"),
      new InlinePromptItem("内联"),
    ]);
    const snapshot = recipe.toSnapshot();
    expect(snapshot.items[0]).toEqual({ kind: "section", sectionId: "novel.identity" });
    expect(snapshot.items[1]).toEqual({
      kind: "section",
      sectionId: "core.runtime.protocol",
      version: "1.0.0",
    });
    expect(snapshot.items[2]).toEqual({ kind: "inline", content: "内联" });
  });

  it("捕获器：段 id / 版本格式校验", () => {
    expect(captureSectionId("novel.doing-tasks")).toBe("novel.doing-tasks");
    expect(() => captureSectionId("Novel.Identity")).toThrow(/invalid/);
    expect(captureVersion("1.0.0")).toBe("1.0.0");
    expect(() => captureVersion("1.0")).toThrow(/invalid/);
  });
});
