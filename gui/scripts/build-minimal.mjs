// 最小构建：esbuild 打包 minimal main + preload（绕开旧 493 文件编译）。
// main → dist/minimal/main.js（ESM），preload → dist/minimal/preload.cjs（CJS）。
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(join(root, "dist/minimal"), { recursive: true });

// 1. main（Electron 主进程，node 环境）
await build({
  entryPoints: [join(root, "src/main/minimal.ts")],
  outfile: join(root, "dist/minimal/main.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron"],
  logLevel: "warning",
});

// 2. preload（Electron preload，CJS）
await build({
  entryPoints: [join(root, "src/preload/minimal-preload.ts")],
  outfile: join(root, "dist/minimal/preload.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  logLevel: "warning",
});

// 3. renderer（browser 环境，ESM；kkrpc 走 browser 版）
await build({
  entryPoints: [join(root, "src/renderer/minimal-renderer.ts")],
  outfile: join(root, "dist/minimal/renderer.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  logLevel: "warning",
});

// 4. 复制 html 到 dist/minimal
await import("node:fs/promises").then(async ({ copyFile }) => {
  await copyFile(join(root, "src/renderer/minimal.html"), join(root, "dist/minimal/minimal.html"));
});

console.log("[build-minimal] main.js + preload.cjs + renderer.js + minimal.html built");
