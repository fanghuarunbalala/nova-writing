import { describe, it, expect } from "vitest";
import {
  PromptSectionRegistry,
  PromptSectionRegistryAssembler,
  PromptSectionRegistryError,
  PROMPT_SECTION_REGISTRY_FAILURE,
} from "../PromptSectionRegistry.js";
import type { PromptSection } from "../PromptSection.js";

function staticSection(id: string, version: string): PromptSection {
  return {
    kind: "static",
    id,
    version,
    label: `Label ${id}`,
    render: () => `${id}@${version}`,
  };
}

describe("PromptSectionRegistry", () => {
  it("注册 id@version，resolve 指定版本精确匹配", () => {
    const registry = new PromptSectionRegistry([
      staticSection("novel.identity", "1.0.0"),
      staticSection("novel.identity", "1.1.0"),
      staticSection("core.runtime.protocol", "1.0.0"),
    ]);
    expect(registry.resolve("novel.identity", "1.0.0").version).toBe("1.0.0");
    expect(registry.resolve("core.runtime.protocol", "1.0.0").id).toBe("core.runtime.protocol");
  });

  it("resolve 未指定版本取最新版（semver 排序）", () => {
    const registry = new PromptSectionRegistry([
      staticSection("novel.identity", "1.0.0"),
      staticSection("novel.identity", "1.9.0"),
      staticSection("novel.identity", "1.10.0"),
    ]);
    expect(registry.resolve("novel.identity").version).toBe("1.10.0");
  });

  it("未知 id / 未知版本报 unknownSection", () => {
    const registry = new PromptSectionRegistry([staticSection("novel.identity", "1.0.0")]);
    expect(() => registry.resolve("novel.missing")).toThrow(PromptSectionRegistryError);
    try {
      registry.resolve("novel.missing");
    } catch (err) {
      expect((err as PromptSectionRegistryError).failure).toBe(
        PROMPT_SECTION_REGISTRY_FAILURE.unknownSection,
      );
    }
    expect(() => registry.resolve("novel.identity", "9.9.9")).toThrow(/unknown_section/);
  });

  it("重复 id@version 报 duplicateSection", () => {
    expect(
      () =>
        new PromptSectionRegistry([
          staticSection("novel.identity", "1.0.0"),
          staticSection("novel.identity", "1.0.0"),
        ]),
    ).toThrow(/duplicate_section/);
  });

  it("list 排序：id 升序、同 id 版本升序", () => {
    const registry = new PromptSectionRegistry([
      staticSection("novel.identity", "1.1.0"),
      staticSection("core.runtime.protocol", "1.0.0"),
      staticSection("novel.identity", "1.0.0"),
    ]);
    const ids = registry.list().map((s) => `${s.id}@${s.version}`);
    expect(ids).toEqual([
      "core.runtime.protocol@1.0.0",
      "novel.identity@1.0.0",
      "novel.identity@1.1.0",
    ]);
  });

  it("Assembler：register 链式 + freeze 幂等 + 冻结后报 assemblyFrozen", () => {
    const assembler = new PromptSectionRegistryAssembler();
    assembler
      .register(staticSection("novel.identity", "1.0.0"))
      .register(staticSection("novel.identity", "1.1.0"));
    const registry = assembler.freeze();
    expect(assembler.freeze()).toBe(registry);
    expect(() => assembler.register(staticSection("core.environment", "1.0.0"))).toThrow(
      /assembly_frozen/,
    );
  });
});
