/**
 * DesktopDesignFileService
 *
 * compose 模式设计草稿文件的读写服务（主进程）。GUI 直接编辑 design 文件，
 * agent 下次 Read 即可看到更新。
 *
 * 安全约束：
 * - 路径永远不离开 Main 进程：renderer 只传 conversationId，由服务拼装路径；
 * - 只允许 `<workspaceRoot>/.novel/design/` 目录内的文件（realpath 校验防逃逸）；
 * - 文件大小上限 512KB。
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { noopLogger, type Logger } from "@novel/core";
import type {
  ElectronBridgeAcknowledgement,
  ElectronBridgeFailure,
  ElectronBridgeResult,
  ElectronDesignFileSnapshot,
} from "../../../shared/index.js";

export interface DesktopDesignFileWorkspaceResolver {
  resolveWorkspaceRoot(senderId: number): string | undefined;
}

export interface DesktopDesignFileServiceOptions {
  readonly resolveWorkspaceRoot: DesktopDesignFileWorkspaceResolver["resolveWorkspaceRoot"];
  readonly logger?: Logger;
}

export interface DesktopDesignFileServicePort {
  read(
    senderId: number,
    conversationId: string,
  ): Promise<ElectronBridgeResult<ElectronDesignFileSnapshot>>;
  write(
    senderId: number,
    conversationId: string,
    content: string,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
}

const MAX_DESIGN_FILE_BYTES = 512 * 1024;

export class DesktopDesignFileService implements DesktopDesignFileServicePort {
  readonly #resolveWorkspaceRoot: DesktopDesignFileWorkspaceResolver["resolveWorkspaceRoot"];
  readonly #logger: Logger;

  constructor(options: DesktopDesignFileServiceOptions) {
    this.#resolveWorkspaceRoot = options.resolveWorkspaceRoot;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "desktop_design_file_service",
    });
  }

  async read(
    senderId: number,
    conversationId: string,
  ): Promise<ElectronBridgeResult<ElectronDesignFileSnapshot>> {
    try {
      const designFilePath = this.#designFilePathFor(senderId, conversationId);
      if (designFilePath === undefined) {
        return failure("design_workspace_unavailable", false);
      }
      const content = await fs.readFile(designFilePath, "utf8");
      const sizeBytes = Buffer.byteLength(content, "utf8");
      if (sizeBytes > MAX_DESIGN_FILE_BYTES) {
        return failure("design_file_too_large", false);
      }
      this.#logger.debug("design_file.read", {
        conversationId,
        sizeBytes,
      });
      return {
        ok: true,
        value: Object.freeze({ conversationId, content, sizeBytes }),
      };
    } catch (error) {
      return failure("design_file_not_found", false);
    }
  }

  async write(
    senderId: number,
    conversationId: string,
    content: string,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>> {
    try {
      const designFilePath = this.#designFilePathFor(senderId, conversationId);
      if (designFilePath === undefined) {
        return failure("design_workspace_unavailable", false);
      }
      const sizeBytes = Buffer.byteLength(content, "utf8");
      if (sizeBytes > MAX_DESIGN_FILE_BYTES) {
        return failure("design_file_too_large", false);
      }
      await fs.mkdir(path.dirname(designFilePath), { recursive: true });
      const tmp = `${designFilePath}.tmp-${randomUUID()}`;
      try {
        await fs.writeFile(tmp, content, "utf8");
        await fs.rename(tmp, designFilePath);
      } catch (error) {
        await fs.rm(tmp, { force: true }).catch(() => undefined);
        throw error;
      }
      this.#logger.debug("design_file.write", {
        conversationId,
        sizeBytes,
      });
      return { ok: true, value: Object.freeze({ acknowledged: true as const }) };
    } catch (error) {
      return failure("design_write_failed", true);
    }
  }

  /** 解析并校验 design 文件路径（仅 workspace/.novel/design/ 内）。 */
  #designFilePathFor(
    senderId: number,
    conversationId: string,
  ): string | undefined {
    if (conversationId.trim().length === 0) return undefined;
    const workspaceRoot = this.#resolveWorkspaceRoot(senderId);
    if (workspaceRoot === undefined) return undefined;
    const designRoot = path.resolve(workspaceRoot, ".novel", "design");
    const safe = conversationId.replace(/[^A-Za-z0-9._-]/g, "-");
    const candidate = path.resolve(designRoot, `${safe}.md`);
    if (!candidate.startsWith(`${designRoot}${path.sep}`)) return undefined;
    return candidate;
  }
}

function failure(code: string, retryable: boolean): ElectronBridgeResult<never> {
  const error: ElectronBridgeFailure = Object.freeze({ code, retryable });
  return { ok: false, error };
}
