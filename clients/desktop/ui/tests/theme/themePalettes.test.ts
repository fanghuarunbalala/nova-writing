/**
 * 主题调色板契约测试：tokens.css 中每个 [data-theme] 覆盖块必须完整覆盖
 * 「:root 基色集合 + 全部阴影 token + 拖拽光标 token」（语义混合 token 引用
 * 基色、自动重derive，不在覆盖块内重定义）；块集合与 ThemeProvider 的
 * THEMES 枚举一致（paper 为 :root 默认、无覆盖块）。配色对比度在主题设计
 * 阶段离线校验（见 docs/design/theme-candidates-demo-2.html），此处只执法
 * 结构完整性。光标 token 必须逐主题覆盖：暗色主题漏定义会回落到 :root 的
 * 浅色光标（浅色箭头在亮底不可见）。
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES } from "../../src/shared/theme/ThemeProvider.js";

const tokensCss = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/shared/theme/tokens.css"),
  "utf8",
);

/** :root 基色集合（覆盖块必须逐一覆盖；语义混合/角色 token 不在此列） */
const BASE_COLORS = [
  "bg", "surface", "surface-2", "fg", "muted", "faint",
  "border", "border-strong",
  "orange", "accent", "red", "accent-ink",
  "success", "success-bg", "warn", "warn-bg",
  "danger", "danger-bg", "info", "info-bg",
  "on-accent",
] as const;

const SHADOWS = ["shadow-1", "shadow-2", "shadow-xs", "shadow-drawer", "shadow-panel"] as const;

/** 主题化拖拽光标（SVG data-uri 固化色值，必须逐主题覆盖） */
const CURSORS = ["cursor-col-resize", "cursor-row-resize"] as const;

const REQUIRED = new Set<string>([
  ...BASE_COLORS.map((name) => `--color-${name}`),
  ...SHADOWS.map((name) => `--${name}`),
  ...CURSORS.map((name) => `--${name}`),
]);

function parseThemeBlocks(css: string): Map<string, Set<string>> {
  const blocks = new Map<string, Set<string>>();
  const blockRe = /\[data-theme="([\w-]+)"\]\s*\{([^}]*)\}/g;
  for (const match of css.matchAll(blockRe)) {
    const [, id, body] = match;
    const names = new Set(
      [...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string),
    );
    blocks.set(id, names);
  }
  return blocks;
}

describe("theme palettes contract", () => {
  const blocks = parseThemeBlocks(tokensCss);

  it("covers every non-default theme in THEMES (paper = :root default, no block)", () => {
    const expected = new Set(THEMES.filter((id) => id !== "paper"));
    expect([...blocks.keys()].sort()).toEqual([...expected].sort());
  });

  it("each block overrides exactly the base color set + all shadows + cursors", () => {
    const violations: string[] = [];
    for (const [id, names] of blocks) {
      const missing = [...REQUIRED].filter((token) => !names.has(token));
      if (missing.length > 0) violations.push(`${id} 缺少: ${missing.join(", ")}`);
      const extra = [...names].filter((token) => !REQUIRED.has(token));
      if (extra.length > 0) violations.push(`${id} 多余: ${extra.join(", ")}`);
    }
    expect(violations).toEqual([]);
  });

  it("dark themes override --color-on-accent away from pure white", () => {
    // 墨夜/黛青强调底提亮，白字对比度不足 4.5:1 → 前景必须翻转为深墨
    const darkThemes = ["ink", "celadon"];
    const bodyRe = (id: string) =>
      new RegExp(`\\[data-theme="${id}"\\][^}]*--color-on-accent:\\s*([^;]+);`);
    for (const id of darkThemes) {
      const match = tokensCss.match(bodyRe(id));
      expect(match, `${id} 应覆盖 --color-on-accent`).not.toBeNull();
      expect(match?.[1]?.trim(), `${id} on-accent 不应为纯白`).not.toBe("#fff");
    }
  });
});
