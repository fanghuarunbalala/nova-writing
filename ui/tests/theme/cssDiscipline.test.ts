/**
 * css 纪律静态检查（规则 a-d）。
 *
 * 每规则收集全部违规为字符串数组（`路径:行号 规则说明`），
 * expect(violations).toEqual([]) —— vitest 失败 diff 即人类可读违规清单。
 *
 * a) 模块 css 禁止颜色字面量（#hex / rgb(a) / hsl(a) / oklch）。
 *    行内 `/* @allow-color 理由 *\/` 豁免（同行为准，多行字面量必须提 token）。
 * b) [data-theme] 覆盖块只允许 --color-* / --shadow-*（三层模型执法）。
 * c) @keyframes 只允许定义在 shared/theme/animations.css，且名不重复
 *    （CSS Modules 会对模块内 animation 引用无条件 hash 重命名）。
 * d) 模块 css 的设计语言属性只允许 0/1px 字面量，其余必须走 var(--token)；
 *    font-weight 纯数字违规（必须 var(--fw-*)）。
 */
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../src");

async function collectCss(dir: string, pattern: RegExp): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectCss(full, pattern)));
    } else if (pattern.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** 规则 a/d 只作用于组件样式；theme 全局 css（token 定义层）天然豁免 */
const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/;
const ALLOW_COLOR = "@allow-color";

/** 规则 d 属性白名单：设计语言类属性（布局/动效属性豁免） */
const PX_PROP_RE =
  /^\s*(padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|gap|inset|top|right|bottom|left|font-size|letter-spacing|border-width|border-radius|outline-width|outline-offset|text-indent)\s*:/;

/** 剥除行内注释（保留注释前的声明部分） */
function stripInlineComment(line: string): string {
  const idx = line.indexOf("/*");
  return idx >= 0 ? line.slice(0, idx) : line;
}

describe("css discipline", () => {
  it("b) [data-theme] 覆盖块只允许 --color-* / --shadow-*", async () => {
    const files = await collectCss(root, /\.css$/);
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const rel = relative(root, file).replaceAll("\\", "/");
      let i = 0;
      while ((i = content.indexOf("[data-theme", i)) !== -1) {
        // 注释内的 [data-theme 提及（头注释说明）跳过
        const lineStart = content.lastIndexOf("\n", i) + 1;
        if (/^\s*(\/\*|\*)/.test(content.slice(lineStart, i))) {
          i += "[data-theme".length;
          continue;
        }
        // 找到包含 [data-theme 的 { ... } 块
        const brace = content.indexOf("{", i);
        let depth = 0;
        let k = brace;
        for (; k < content.length; k++) {
          if (content[k] === "{") depth++;
          else if (content[k] === "}") {
            depth--;
            if (depth === 0) break;
          }
        }
        const block = content.slice(brace + 1, k);
        const baseLine = content.slice(0, i).split("\n").length;
        for (const line of block.split("\n")) {
          const t = line.trim();
          if (t.length === 0 || t.startsWith("/*") || t.startsWith("*")) continue; // 空行/注释合法
          if (/^--(color|shadow)-[a-z0-9-]*\s*:/.test(t)) continue; // 色层/阴影 token 合法
          violations.push(
            `${rel}:${baseLine} [data-theme] 块内 "${t.slice(0, 40)}" 违规（仅允许 --color-* / --shadow-*）`,
          );
        }
        i = k + 1;
      }
    }
    expect(violations).toEqual([]);
  });

  it("c) @keyframes 只允许定义在 animations.css 且名不重复", async () => {
    const files = await collectCss(root, /\.css$/);
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const rel = relative(root, file).replaceAll("\\", "/");
      const isAnimations = rel === "shared/theme/animations.css";
      const names: string[] = [];
      for (const m of content.matchAll(/@keyframes\s+([a-zA-Z0-9-]+)/g)) {
        names.push(m[1]);
      }
      if (!isAnimations && names.length > 0) {
        violations.push(
          `${rel} 本地 @keyframes ${names.join("/")} 应集中到 shared/theme/animations.css`,
        );
      }
      if (isAnimations) {
        const dupes = names.filter((n, j) => names.indexOf(n) !== j);
        for (const d of new Set(dupes)) {
          violations.push(`${rel} @keyframes ${d} 重复定义`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("a) module.css 禁止颜色字面量（@allow-color 行内豁免）", async () => {
    const files = await collectCss(root, /\.module\.css$/);
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const rel = relative(root, file).replaceAll("\\", "/");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (line.includes(ALLOW_COLOR)) return; // 行内豁免（同行为准）
        const head = stripInlineComment(line).trim();
        if (head.startsWith("*") || head.length === 0) return; // 注释块正文/空行
        if (COLOR_LITERAL_RE.test(head)) {
          violations.push(`${rel}:${i + 1} 颜色字面量 "${head.trim()}" 应使用 var(--token) 或行内 /* ${ALLOW_COLOR} 理由 */`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("d) module.css 字面量 px 只允许 0/1px，font-weight 必须走 token", async () => {
    const files = await collectCss(root, /\.module\.css$/);
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const rel = relative(root, file).replaceAll("\\", "/");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, i) => {
        const head = stripInlineComment(line);
        if (PX_PROP_RE.test(head)) {
          // 先剥掉 var(--token)（--space-2px 等 token 名内含数字会误报为字面量；
          // 带 fallback 的 var(--token, 860px) 一并剥除——token 已定义时 fallback 是死代码）
          const raw = head.replace(/var\(--[a-z0-9-]+(?:,\s*[^)]+)?\)/g, "");
          for (const match of raw.matchAll(/(\d+(?:\.\d+)?)px/g)) {
            const v = match[1];
            if (v !== "0" && v !== "1") {
              violations.push(
                `${rel}:${i + 1} 字面量 ${v}px 应使用 var(--space-*px)（非刻度值先建精确值快照 token）`,
              );
            }
          }
          return;
        }
        const fw = head.match(/^\s*font-weight\s*:\s*(\d+)\s*;?/);
        if (fw) {
          violations.push(`${rel}:${i + 1} font-weight 纯数字 ${fw[1]} 应使用 var(--fw-*)`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
