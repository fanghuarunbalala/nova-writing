/** Cross-process lock file with heartbeat and conservative stale-lock cleanup. */
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink, utimes } from "node:fs/promises";
import { noopLogger, type Logger } from "../../observability/index.js";
import { MessageProjectionFileLockTimeoutError } from "./MessageFileStoreErrors.js";

interface MessageFileLockRecord {
  token: string;
  pid: number;
  conversationId: string;
  createdAt: string;
}

export interface ConversationMessageFileLockOptions {
  logger?: Logger;
  waitTimeoutMs?: number;
  retryDelayMs?: number;
  heartbeatMs?: number;
  staleTimeoutMs?: number;
}

export class ConversationMessageFileLock {
  private readonly logger: Logger;
  private readonly waitTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly heartbeatMs: number;
  private readonly staleTimeoutMs: number;

  constructor(options: ConversationMessageFileLockOptions = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_message_file_lock",
    });
    this.waitTimeoutMs = options.waitTimeoutMs ?? 5_000;
    this.retryDelayMs = options.retryDelayMs ?? 25;
    this.heartbeatMs = options.heartbeatMs ?? 5_000;
    this.staleTimeoutMs = options.staleTimeoutMs ?? 60_000;
    this.assertPositive("waitTimeoutMs", this.waitTimeoutMs);
    this.assertPositive("retryDelayMs", this.retryDelayMs);
    this.assertPositive("heartbeatMs", this.heartbeatMs);
    this.assertPositive("staleTimeoutMs", this.staleTimeoutMs);
    if (this.staleTimeoutMs <= this.heartbeatMs) {
      throw new TypeError("staleTimeoutMs must be greater than heartbeatMs");
    }
  }

  async withExclusive<T>(
    conversationId: string,
    conversationDir: string,
    lockPath: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    await mkdir(conversationDir, { recursive: true });
    const token = randomUUID();
    const deadline = Date.now() + this.waitTimeoutMs;

    this.logger.debug("message_projection.lock.acquire_started", { conversationId });
    while (true) {
      try {
        await this.createLock(lockPath, {
          token,
          pid: process.pid,
          conversationId,
          createdAt: new Date().toISOString(),
        });
        break;
      } catch (error) {
        if (!this.isNodeError(error, "EEXIST")) throw error;
        await this.removeStaleLock(conversationId, lockPath);
        if (Date.now() >= deadline) {
          throw new MessageProjectionFileLockTimeoutError(conversationId);
        }
        await this.delay(this.retryDelayMs);
      }
    }

    this.logger.debug("message_projection.lock.acquired", { conversationId });
    let heartbeatActive = true;
    const heartbeat = setInterval(() => {
      if (!heartbeatActive) return;
      const now = new Date();
      void utimes(lockPath, now, now).catch(() => undefined);
    }, this.heartbeatMs);
    heartbeat.unref();

    try {
      return await operation();
    } finally {
      heartbeatActive = false;
      clearInterval(heartbeat);
      await this.releaseOwnedLock(lockPath, token);
      this.logger.debug("message_projection.lock.released", { conversationId });
    }
  }

  private async createLock(lockPath: string, record: MessageFileLockRecord): Promise<void> {
    const handle = await open(lockPath, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(record), "utf8");
      await handle.sync();
    } catch (error) {
      await unlink(lockPath).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }
  }

  private async removeStaleLock(conversationId: string, lockPath: string): Promise<void> {
    try {
      const lockStats = await stat(lockPath);
      if (Date.now() - lockStats.mtimeMs <= this.staleTimeoutMs) return;
      await unlink(lockPath);
      this.logger.info("message_projection.lock.stale_removed", { conversationId });
    } catch (error) {
      if (!this.isNodeError(error, "ENOENT")) throw error;
    }
  }

  private async releaseOwnedLock(lockPath: string, token: string): Promise<void> {
    try {
      const text = await readFile(lockPath, "utf8");
      const record = JSON.parse(text) as Partial<MessageFileLockRecord>;
      if (record.token === token) await unlink(lockPath);
    } catch (error) {
      if (!this.isNodeError(error, "ENOENT")) throw error;
    }
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
  }

  private assertPositive(label: string, value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${label} must be a positive safe integer`);
    }
  }

  private isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
  }
}
