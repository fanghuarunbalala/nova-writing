/**
 * Best-effort 目录 fsync 共享工具（Shared best-effort directory fsync helper）。
 *
 * 原子写（临时文件 → rename）后对父目录做 fsync 是 POSIX 语义：确保 rename 后的目录项
 * 落盘。但 Windows/NTFS 不支持对目录调用 fsync —— `open(dir, "r")` 成功而
 * `handle.sync()` 抛 `EPERM: operation not permitted, fsync`（部分文件系统/平台也可能
 * 抛 EINVAL / ENOTSUP / EBADF / EISDIR / ENOSYS）。
 *
 * 本 helper 只忽略上述"平台不支持目录 fsync"类错误，其余真实 I/O 错误照抛，从而：
 * - Windows 上原子写可正常完成（NTFS 目录项随文件 fsync 一并刷新，跳过不损失正确性）；
 * - POSIX 上保持原有持久化语义（fsync 失败仍会暴露给调用方）。
 *
 * On POSIX this preserves real durability semantics by re-throwing genuine I/O errors;
 * on platforms where directory fsync is unsupported (e.g. Windows/NTFS) it skips the
 * call so atomic writes complete normally, since directory entries are flushed
 * alongside the file fsync anyway.
 */
import { open } from "node:fs/promises";

/** Directory-fsync-unsupported error codes, matched by NodeJS `error.code`. */
const DIRECTORY_FSYNC_UNSUPPORTED_CODES = new Set<string>([
  "EPERM",
  "EINVAL",
  "ENOTSUP",
  "EBADF",
  "EISDIR",
  "ENOSYS",
]);

/**
 * Best-effort fsync a directory, ignoring only platform-unsupported errors.
 * @param directoryPath - directory to fsync（fsync 的目标目录）。
 * @returns resolves when the directory was fsynced or the unsupported error was swallowed.
 */
export async function syncDirectoryBestEffort(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, "r");
  try {
    await handle.sync();
  } catch (error) {
    if (!isDirectoryFsyncUnsupported(error)) throw error;
  } finally {
    await handle.close();
  }
}

function isDirectoryFsyncUnsupported(error: unknown): boolean {
  return error instanceof Error && "code" in error &&
    DIRECTORY_FSYNC_UNSUPPORTED_CODES.has((error as NodeJS.ErrnoException).code ?? "");
}
