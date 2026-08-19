/**
 * token 纪律静态检查：所有组件 css 引用的 var(--*) 必须定义在 tokens.css，
 * 防止拼写错误与绕过 token 的硬编码。
 */
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../src");

/**
 * 运行时注入的动态变量豁免：TSX 以 inline style 按实例注入（值随数据变化，
 * 不可能是 tokens.css 的静态设计值），不参与本纪律：
 * - view-count：TopBarViewSwitcher 列数（随书库门控 3/4）
 * - cover-1/cover-2：ProjectSelectionPage 书封双色（按项目名哈希取色板）
 */
const RUNTIME_INJECTED_VARS = new Set(["view-count", "cover-1", "cover-2"]);

async function collectCss(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectCss(full)));
    } else if (entry.name.endsWith(".css")) {
      files.push(full);
    }
  }
  return files;
}

describe("design token discipline", () => {
  it("every var(--*) referenced by component css is defined in tokens.css", async () => {
    const tokens = await readFile(join(root, "shared/theme/tokens.css"), "utf8");
    const defined = new Set<string>();
    for (const match of tokens.matchAll(/--([a-z0-9-]+):/g)) {
      defined.add(match[1]);
    }
    const cssFiles = (await collectCss(root)).filter(
      (file) => !file.endsWith("/theme/tokens.css"),
    );
    const missing = new Set<string>();
    for (const file of cssFiles) {
      const content = await readFile(file, "utf8");
      for (const match of content.matchAll(/var\(--([a-z0-9-]+)/g)) {
        if (RUNTIME_INJECTED_VARS.has(match[1])) continue;
        if (!defined.has(match[1])) missing.add(`${relative(root, file)}: --${match[1]}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
