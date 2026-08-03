/** Builds the Web shell as relative static assets for flexible same-origin hosting. */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist/browser-app",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
  },
});
