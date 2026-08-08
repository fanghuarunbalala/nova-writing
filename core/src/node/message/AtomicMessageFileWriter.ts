/** Durable append, truncate, and same-directory atomic replacement primitives. */
import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { syncDirectoryBestEffort } from "../fs/index.js";
import { AtomicMessageFileReplacement } from "./AtomicMessageFileReplacement.js";

export class AtomicMessageFileWriter {
  beginReplacement(
    conversationId: string,
    filePath: string,
  ): Promise<AtomicMessageFileReplacement> {
    return AtomicMessageFileReplacement.create(conversationId, filePath);
  }

  async cleanupAbandonedReplacements(filePath: string): Promise<number> {
    const directory = dirname(filePath);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (this.isNodeError(error, "ENOENT")) return 0;
      throw error;
    }

    const escapedName = this.escapeRegExp(basename(filePath));
    const pattern = new RegExp(
      `^\\.${escapedName}-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\.rebuild$`,
    );
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !pattern.test(entry.name)) continue;
      try {
        await unlink(join(directory, entry.name));
        removed += 1;
      } catch (error) {
        if (!this.isNodeError(error, "ENOENT")) throw error;
      }
    }
    return removed;
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      if (this.isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  }

  async initialize(filePath: string, content: string): Promise<void> {
    await this.writeTemporaryAndRename(filePath, content);
  }

  async replace(filePath: string, content: string): Promise<void> {
    await this.writeTemporaryAndRename(filePath, content);
  }

  async append(filePath: string, content: string): Promise<void> {
    const handle = await open(filePath, "a", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async truncate(filePath: string, byteLength: number): Promise<void> {
    const handle = await open(filePath, "r+");
    try {
      await handle.truncate(byteLength);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async writeTemporaryAndRename(filePath: string, content: string): Promise<void> {
    const directory = dirname(filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = join(directory, `.${basename(filePath)}.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }

    try {
      await rename(temporaryPath, filePath);
      await this.syncDirectory(directory);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private async syncDirectory(directory: string): Promise<void> {
    await syncDirectoryBestEffort(directory);
  }

  private isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
