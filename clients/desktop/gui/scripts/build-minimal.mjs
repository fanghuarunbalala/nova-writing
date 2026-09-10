// 最小构建：esbuild 打包 main + preload（CJS），renderer 走 Vite（处理 CSS Modules + React）。
// main → dist/minimal/main.cjs，preload → dist/minimal/preload.cjs，renderer → dist/minimal/index.html + assets。
import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(join(root, "dist/minimal"), { recursive: true });

// 1. main（Electron 主进程，cjs——Electron main 默认 cjs，避免 ESM 下 pino 动态 require 失败）
// @novel/core/node 及 kkrpc external，让 Electron main 运行时从各自包的 node_modules 解析
// （zeromq/pino 是 @novel/core 的传递依赖，随其 ESM 解析）
await build({
  entryPoints: [join(root, "src/main/minimal.ts")],
  outfile: join(root, "dist/minimal/main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "kkrpc", "@novel/core", "@novel/core/node"],
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

// 3. renderer（Vite：处理 CSS Modules + React，产出 index.html + assets 到 dist/minimal）
await viteBuild({ configFile: join(root, "vite.config.ts"), logLevel: "warn" });

console.log("[build-minimal] main.cjs + preload.cjs + index.html + assets built");
