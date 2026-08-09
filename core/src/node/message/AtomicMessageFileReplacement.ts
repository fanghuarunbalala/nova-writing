/** Low-level same-directory staging file used by one atomic replacement. */
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { syncDirectoryBestEffort } from "../fs/syncDirectory.js";
import {
  MessageProjectionFileOperationError,
  MessageProjectionReplacementDurabilityError,
} from "./MessageFileStoreErrors.js";

type AtomicReplacementState = "open" | "closed" | "renamed" | "committed" | "aborted";

export class AtomicMessageFileReplacement {
  readonly stagingPath: string;

  private state: AtomicReplacementState = "open";

  private constructor(
    private readonly conversationId: string,
    private readonly targetPath: string,
    private readonly handle: FileHandle,
    stagingPath: string,
  ) {
    this.stagingPath = stagingPath;
  }

  static async create(
    conversationId: string,
    targetPath: string,
  ): Promise<AtomicMessageFileReplacement> {
    const directory = dirname(targetPath);
    await mkdir(directory, { recursive: true });
    const stagingPath = join(
      directory,
      `.${basename(targetPath)}-${randomUUID()}.rebuild`,
    );
    const handle = await open(stagingPath, "wx", 0o600);
    return new AtomicMessageFileReplacement(
      conversationId,
      targetPath,
      handle,
      stagingPath,
    );
  }

  async append(content: string): Promise<void> {
    this.assertState("open");
    await this.handle.writeFile(content, "utf8");
  }

  async syncAndClose(): Promise<void> {
    this.assertState("open");
    try {
      await this.handle.sync();
    } finally {
      await this.handle.close();
      this.state = "closed";
    }
  }

  async commit(): Promise<void> {
    this.assertState("closed");
    const directory = dirname(this.targetPath);
    await rename(this.stagingPath, this.targetPath);
    this.state = "renamed";
    try {
      await this.syncDirectory(directory);
      this.state = "committed";
    } catch (error) {
      throw new MessageProjectionReplacementDurabilityError(this.conversationId, {
        cause: error,
      });
    }
  }

  async abort(): Promise<void> {
    if (this.state === "committed" || this.state === "renamed" || this.state === "aborted") {
      return;
    }
    if (this.state === "open") {
      await this.handle.close().catch(() => undefined);
    }
    await unlink(this.stagingPath).catch(() => undefined);
    this.state = "aborted";
  }

  private async syncDirectory(directory: string): Promise<void> {
    await syncDirectoryBestEffort(directory);
  }

  private assertState(expected: AtomicReplacementState): void {
    if (this.state !== expected) {
      throw new MessageProjectionFileOperationError(
        `Atomic Message file replacement must be ${expected}, received ${this.state}`,
      );
    }
  }
}
