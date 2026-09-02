#!/usr/bin/env node
/**
 * 将 src 下所有 .css 文件复制到 dist，保持相对目录结构。
 * tsc 不产出 CSS；@novel/ui 以 dist 形式被 gui/web（Vite）消费，
 * 组件与其 .module.css / 全局 CSS 必须相邻。
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const outDir = join(root, "dist");

async function collectCss(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
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

const cssFiles = await collectCss(srcDir);
let copied = 0;
for (const file of cssFiles) {
  const rel = relative(srcDir, file);
  const dest = join(outDir, rel);
  await mkdir(dirname(dest), { recursive: true });
  await cp(file, dest);
  copied += 1;
}
console.log(`copied ${copied} css file(s) to dist`);
