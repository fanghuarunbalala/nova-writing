// 目录 fsync 在 Windows 上不受支持（fs.open(dir).fsync() 必抛 EPERM）。调用方在
// rename 已落地之后才做目录 fsync，它只是崩溃持久化优化，不是数据落盘本身。
// 因此这里"尽力而为"：吞掉平台不支持目录 fsync 类错误，其余真实 I/O 错误照常抛出。
import { open } from "node:fs/promises";

const UNSUPPORTED_SYNC_CODES = new Set([
  "EPERM",
  "ENOTSUP",
  "EINVAL",
  "EISDIR",
  "ENOTTY",
]);

/** 对目录执行 fsync，忽略平台不支持的目录 fsync 错误（如 Windows 的 EPERM）。
 *  目录不可打开时静默跳过；真实 I/O 错误（EACCES/EIO 等）原样抛出。 */
export async function syncDirectoryBestEffort(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, "r");
  } catch {
    return; // 目录不可打开（如已被移除）时跳过
  }
  try {
    await handle.sync();
  } catch (error) {
    if (!isUnsupportedSyncError(error)) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isUnsupportedSyncError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const code = typeof error.code === "string" ? error.code : undefined;
  return code !== undefined && UNSUPPORTED_SYNC_CODES.has(code);
}
