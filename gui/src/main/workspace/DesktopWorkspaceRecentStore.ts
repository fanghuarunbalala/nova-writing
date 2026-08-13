/**
 * DesktopWorkspaceRecentStore
 *
 * 最近打开的 Workspace 跨重启持久化：写入 userData 下的 JSON 文件，
 * 采用「临时文件 + rename」原子写。文件损坏或缺失时回退为空列表。
 *
 * 仅存 session 视图（id + label），不落任何路径、配置或事件数据。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { noopLogger, type Logger } from "@novel/core";
import type { ElectronWorkspaceSession } from "../../shared/index.js";

export interface DesktopWorkspaceRecentStorePort {
  load(): Promise<readonly ElectronWorkspaceSession[]>;
  record(session: ElectronWorkspaceSession): Promise<void>;
}

export interface DesktopWorkspaceRecentStoreOptions {
  readonly filePath: string;
  readonly limit?: number;
  readonly logger?: Logger;
}

const DEFAULT_LIMIT = 10;

function isSession(value: unknown): value is ElectronWorkspaceSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.id === "string" &&
    session.id.length > 0 &&
    typeof session.label === "string"
  );
}

export class DesktopWorkspaceRecentStore
  implements DesktopWorkspaceRecentStorePort
{
  private readonly filePath: string;
  private readonly limit: number;
  private readonly logger: Logger;
  private loaded = false;
  private loadPromise?: Promise<void>;
  private sessions: readonly ElectronWorkspaceSession[] = Object.freeze([]);

  constructor(options: DesktopWorkspaceRecentStoreOptions) {
    this.filePath = options.filePath;
    this.limit = options.limit ?? DEFAULT_LIMIT;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_workspace_recent_store",
    });
  }

  async load(): Promise<readonly ElectronWorkspaceSession[]> {
    await this.ensureLoaded();
    return this.sessions;
  }

  async record(session: ElectronWorkspaceSession): Promise<void> {
    await this.ensureLoaded();
    const next = Object.freeze(
      [
        session,
        ...this.sessions.filter((existing) => existing.id !== session.id),
      ].slice(0, this.limit),
    );
    this.sessions = next;
    await this.write(next);
    this.logger.debug("desktop_workspace.recent_recorded", {
      recentCount: next.length,
    });
  }

  private ensureLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadPromise === undefined) {
      this.loadPromise = this.readFromDisk().then((sessions) => {
        this.sessions = sessions;
        this.loaded = true;
      });
    }
    return this.loadPromise;
  }

  private async readFromDisk(): Promise<readonly ElectronWorkspaceSession[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isEnoent(error)) {
        this.logger.debug("desktop_workspace.recent_missing");
        return Object.freeze([]);
      }
      this.logger.warn("desktop_workspace.recent_read_failed");
      return Object.freeze([]);
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new TypeError("recent shape invalid");
      return Object.freeze(
        parsed.filter(isSession).slice(0, this.limit),
      );
    } catch (error) {
      this.logger.warn("desktop_workspace.recent_parse_failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return Object.freeze([]);
    }
  }

  private async write(sessions: readonly ElectronWorkspaceSession[]): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
