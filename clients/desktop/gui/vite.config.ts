/** Builds the Electron Renderer (minimal-renderer.tsx) with CSS Modules + relative assets. */
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "src/renderer");

export default defineConfig({
  base: "./",
  plugins: [react()],
  root,
  // kkrpc 的 remote-refs 用模块级 WeakSet 标记 ref：跨包（core vs gui）解析到
  // 不同副本会分裂 WeakSet（proxy 标记与 codec 检查不是同一实例 → RPCEncodeError）。
  // dedupe 强制整个 bundle 单实例（ESM/CJS 双构建分裂在 main 侧靠注入 proxy 解决，这里只限 renderer）
  resolve: {
    dedupe: ["kkrpc"],
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist/minimal"),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(root, "minimal.html"),
    },
  },
  server: {
    host: "127.0.0.1",
  },
});
