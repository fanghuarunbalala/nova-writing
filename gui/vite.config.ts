/** Builds the Electron Renderer as relative static assets for file loading. */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist/renderer-app",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
  },
});
