/** Writes the GUI build mode consumed by the Electron main process at runtime. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] === "debug" ? "debug" : "release";
const distDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
);
await mkdir(distDirectory, { recursive: true });
await writeFile(
  join(distDirectory, "build-mode.json"),
  `${JSON.stringify({ mode })}\n`,
  "utf8",
);
console.log(`GUI build mode: ${mode}`);
