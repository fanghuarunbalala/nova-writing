/** Builds the Electron Renderer (minimal-renderer.tsx) with CSS Modules + relative assets. */
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "src/renderer");

export default defineConfig({
  base: "./",
  plugins: [react()],
  root,
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
