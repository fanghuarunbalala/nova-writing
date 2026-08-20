/**
 * 全新构建清理：删除各包构建产物（core/ui/gui 的 dist）。
 * `pnpm build` 每次执行前调用（每次重新开始，避免改名/删除源码后 dist 残留
 * 旧文件）；`pnpm clean` 可单独执行。只清构建产物，不触碰源码与运行期
 * userData（config.json / workspaces.json 等不受影响）。
 */
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = ["core/dist", "ui/dist", "gui/dist"];

for (const relative of TARGETS) {
  const target = join(repoRoot, relative);
  if (!existsSync(target)) {
    console.log(`[clean] ${relative} 不存在，跳过`);
    continue;
  }
  try {
    // maxRetries/retryDelay：Windows 下文件偶尔短暂占用（杀毒扫描等）
    rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    console.log(`[clean] 已删除 ${relative}`);
  } catch (error) {
    console.error(`[clean] 无法删除 ${relative}：${error.code ?? error.message}`);
    if (error.code === "EBUSY" || error.code === "EPERM") {
      console.error("[clean] 文件被占用——请先关闭正在运行的 Electron 应用后重试");
    }
    process.exitCode = 1;
  }
}
if (process.exitCode !== 1) console.log("[clean] 构建产物已清理完毕");
