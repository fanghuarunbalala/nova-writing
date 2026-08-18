import { describe, it, expect } from "vitest";
import {
  parseAndValidateIndex,
  parseAndValidateCaseFile,
  validateMemoryTree,
  type MemoryFileReader,
} from "../memoryValidator.js";
import { renderMemoryBlock, diffIndexNames, digestOf, presetDigestOf } from "../memoryRender.js";
import { emptyMemoryIndex } from "../memorySchema.js";

const INDEX_OK = `version: 3
prose:
  - name: 战斗
    desc: 短兵相接的近身打斗与攻防节奏段落
    path: .novel/references/prose/combat.yaml
`;

const PROSE_OK = `kind: prose
name: 战斗
desc: 短兵相接的近身打斗与攻防节奏段落
updated: 2026-08-18
entries:
  - id: "001"
    source: paste
    added: 2026-08-18
    text: |
      三段轻功掠过檐角,风声在耳边收紧。
`

const STORY_OK = `kind: story
name: 复仇
desc: 待用的复仇题材故事点子
updated: 2026-08-18
entries:
  - id: "001"
    source: author-request
    added: 2026-08-18
    used: false
    text: |
      一个渔村少年在风暴夜捡到敌国沉船的账本,十年后以账本为饵复仇。
`

/** 内存文件读取器(测试注入) */
function memoryReader(files: Record<string, string>): MemoryFileReader {
  return {
    read: async (rel) => files[rel],
    list: async (dir) =>
      Object.keys(files)
        .filter((f) => f.startsWith(`${dir}/`))
        .sort(),
  };
}

describe("parseAndValidateIndex(MEMORY.yaml)", () => {
  it("合法目录通过", () => {
    const r = parseAndValidateIndex(INDEX_OK);
    expect(r.errors).toEqual([]);
    expect(r.value?.version).toBe(3);
    expect(r.value?.prose?.[0]?.name).toBe("战斗");
  });

  it("version 非法/缺 name/desc/path/域内重名 各自报错", () => {
    const r = parseAndValidateIndex(`version: 0
prose:
  - name: 战斗
    desc: d
    path: .novel/references/prose/a.yaml
  - name: 战斗
    desc: d2
    path: .novel/references/prose/b.yaml
`);
    expect(r.errors.some((e) => e.includes("version"))).toBe(true);
    expect(r.errors.some((e) => e.includes("重复"))).toBe(true);
  });

  it("path 不在对应域目录下报错", () => {
    const r = parseAndValidateIndex(`version: 1
prose:
  - name: 战斗
    desc: d
    path: .novel/references/story/a.yaml
`);
    expect(r.errors.some((e) => e.includes("references/prose"))).toBe(true);
  });

  it("YAML 解析失败转为校验错误", () => {
    const r = parseAndValidateIndex("version: [1,");
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toContain("YAML 解析失败");
  });
});

describe("parseAndValidateCaseFile(案例文件)", () => {
  it("prose 合法通过", () => {
    const r = parseAndValidateCaseFile(PROSE_OK, { domain: "prose", preset: false });
    expect(r.errors).toEqual([]);
  });

  it("prose 超长 text 报错", () => {
    const long = PROSE_OK.replace("三段轻功掠过檐角,风声在耳边收紧。", "长".repeat(301));
    const r = parseAndValidateCaseFile(long, { domain: "prose", preset: false });
    expect(r.errors.some((e) => e.includes("超过上限 300"))).toBe(true);
  });

  it("prose 条数超上限 5 报错(preset 豁免)", () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      `  - id: "${String(i + 1).padStart(3, "0")}"\n    source: paste\n    added: 2026-08-18\n    text: |\n      例句${i}`,
    ).join("\n");
    const file = `kind: prose\nname: 战斗\ndesc: d\nentries:\n${entries}\n`;
    expect(
      parseAndValidateCaseFile(file, { domain: "prose", preset: false }).errors.some((e) =>
        e.includes("超过上限 5"),
      ),
    ).toBe(true);
    expect(
      parseAndValidateCaseFile(file, { domain: "prose", preset: true }).errors.filter((e) =>
        e.includes("超过上限"),
      ),
    ).toEqual([]);
  });

  it("story source 硬闸:仅 author-request;used 格式校验;preset 不得有 used", () => {
    const bad = STORY_OK.replace("source: author-request", "source: paste");
    expect(
      parseAndValidateCaseFile(bad, { domain: "story", preset: false }).errors.some((e) =>
        e.includes("author-request"),
      ),
    ).toBe(true);
    const badDate = STORY_OK.replace("used: false", "used: 昨天");
    expect(
      parseAndValidateCaseFile(badDate, { domain: "story", preset: false }).errors.some((e) =>
        e.includes("used"),
      ),
    ).toBe(true);
    const preset = STORY_OK.replace("    used: false\n", "");
    expect(
      parseAndValidateCaseFile(preset, { domain: "story", preset: true }).errors.filter((e) =>
        e.includes("used"),
      ),
    ).toEqual([]);
  });

  it("id 重复 / 非三位序号 报错", () => {
    const file = PROSE_OK.replace('id: "001"', 'id: "1"');
    expect(
      parseAndValidateCaseFile(file, { domain: "prose", preset: false }).errors.some((e) =>
        e.includes("三位序号"),
      ),
    ).toBe(true);
  });
});

describe("validateMemoryTree(交叉一致性)", () => {
  it("MEMORY.yaml 缺失 = 合法空初态", async () => {
    const tree = await validateMemoryTree(memoryReader({}));
    expect(tree.errors).toEqual([]);
    expect(tree.indexExists).toBe(false);
    expect(tree.index.version).toBe(1);
  });

  it("目录条目与文件一致 → 通过", async () => {
    const tree = await validateMemoryTree(
      memoryReader({
        "MEMORY.yaml": INDEX_OK,
        ".novel/references/prose/combat.yaml": PROSE_OK,
      }),
    );
    expect(tree.errors).toEqual([]);
  });

  it("路径悬空 / 孤儿文件 / name-desc 不一致 报错", async () => {
    const tree = await validateMemoryTree(
      memoryReader({
        "MEMORY.yaml": INDEX_OK,
        ".novel/references/prose/other.yaml": PROSE_OK, // 悬空 + 孤儿(combat.yaml 不存在,other 无目录条目)
      }),
    );
    expect(tree.errors.some((e) => e.includes("文件不存在"))).toBe(true);
    expect(tree.errors.some((e) => e.includes("孤儿文件"))).toBe(true);
    const mismatch = await validateMemoryTree(
      memoryReader({
        "MEMORY.yaml": INDEX_OK,
        ".novel/references/prose/combat.yaml": PROSE_OK.replace("desc: 短兵相接的近身打斗与攻防节奏段落", "desc: 另一句"),
      }),
    );
    expect(mismatch.errors.some((e) => e.includes("desc") && e.includes("不一致"))).toBe(true);
  });

  it("preset 扫描:错误文案指向作者;usedPresets 悬空引用报错", async () => {
    const presetFile = STORY_OK.replace("    used: false\n", "").replace(
      "source: author-request",
      "source: preset",
    );
    const tree = await validateMemoryTree(
      memoryReader({
        "MEMORY.yaml": `version: 1
usedPresets:
  - story/复仇.yaml#002
`,
        ".novel/preset/story/复仇.yaml": presetFile,
      }),
    );
    expect(tree.presetErrors.length).toBe(0);
    expect(tree.errors.some((e) => e.includes("预设条目不存在"))).toBe(true);

    const badPreset = presetFile.replace("kind: story", "kind: prose");
    const tree2 = await validateMemoryTree(
      memoryReader({
        "MEMORY.yaml": "version: 1\n",
        ".novel/preset/story/复仇.yaml": badPreset,
      }),
    );
    expect(tree2.presetErrors.some((e) => e.includes("作者手动修复"))).toBe(true);
    expect(tree2.presetEntries.length).toBe(0);
  });
});

describe("render 与 digest", () => {
  it("renderMemoryBlock 渲染三域目录 + 预设段 + footer;problems 时渲染修复指引", () => {
    const index = parseAndValidateIndex(INDEX_OK).value!;
    const block = renderMemoryBlock(index, [
      { name: "复仇", desc: "待用", path: ".novel/preset/story/复仇.yaml" },
    ]);
    expect(block).toContain('<memory version="3">');
    expect(block).toContain("prose · 战斗");
    expect(block).toContain("## 预设（作者资产，只读；agent 不得修改）");
    expect(block).toContain("防抄袭");
    const broken = renderMemoryBlock(emptyMemoryIndex(), [], ["MEMORY.yaml: 坏了"]);
    expect(broken).toContain("校验未通过");
    expect(broken).toContain("- MEMORY.yaml: 坏了");
  });

  it("空库渲染含入库提示;diffIndexNames 给出 ±类目", () => {
    const block = renderMemoryBlock(emptyMemoryIndex(), []);
    expect(block).toContain("尚无任何案例");
    const prev = emptyMemoryIndex();
    const next = parseAndValidateIndex(INDEX_OK).value!;
    expect(diffIndexNames(prev, next)).toBe("+prose:战斗");
  });

  it("digestOf/presetDigestOf:内容变则变,顺序无关", () => {
    expect(digestOf("a")).not.toBe(digestOf("b"));
    const files = [
      { path: "p/a.yaml", content: "x" },
      { path: "p/b.yaml", content: "y" },
    ];
    expect(presetDigestOf(files)).toBe(presetDigestOf([...files].reverse()));
    expect(presetDigestOf(files)).not.toBe(
      presetDigestOf([{ path: "p/a.yaml", content: "z" }, files[1]!]),
    );
  });
});
