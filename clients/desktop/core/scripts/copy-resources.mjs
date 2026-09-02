/**
 * 构建资源拷贝：core/resources → core/dist/resources（tsc 只编译 TS，不搬运
 * 非 TS 资源；agent-cases 案例库等运行时只读资源依赖本脚本进 dist 随包分发）。
 * 幂等：每次全量覆盖 dist/resources，与 tsc 增量无冲突；resources 不存在则跳过。
 */
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const src = join(scriptDir, "..", "resources");
const dest = join(scriptDir, "..", "dist", "resources");

if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log(`[copy-resources] ${src} -> ${dest}`);
} else {
  console.log(`[copy-resources] skip: ${src} not found`);
}
