import { rm } from "node:fs/promises";

/**
 * Windows 下递归删除临时目录的容错封装。SQLite WAL 会在库旁生成 `-wal`/`-shm`
 * sidecar；Windows 上连接关闭后 `-shm` 内存映射句柄可能未同步释放，导致 `rm`
 * 立即执行时抛出 EBUSY（测试逻辑已完成，仅清理阶段崩溃）。这里对
 * EBUSY/EPERM/ENOTEMPTY 短延迟重试，句柄几乎总在几百毫秒内释放。
 *
 * Resilient recursive temp-directory removal. On Windows, a just-closed SQLite WAL
 * connection may not yet have released its `-shm` file mapping, so `rm` can throw
 * EBUSY during cleanup. Retries those codes briefly; the handle almost always
 * releases within a few hundred milliseconds.
 */
export async function removeTempDirectory(root, options = {}) {
  const attempts = options.attempts ?? 20;
  const delayMs = options.delayMs ?? 50;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code = error?.code;
      if (
        (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY") &&
        attempt < attempts
      ) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
