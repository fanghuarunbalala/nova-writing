/**
 * DesktopNativeFileService
 *
 * 原生文件选择服务（spec 5.4 DesktopNativeFilePort）。包装 Electron dialog +
 * shell，向 renderer 暴露 selectFile / selectDirectory / previewFile。
 *
 * 安全约束：
 * - filesystem path 永远不离开 Main 进程；renderer 只看到 opaque referenceId
 * - per-sender 维护 referenceId -> path 映射，sender 释放时清理
 * - dialog 在 Main 进程弹出，使用 sender 的 BrowserWindow 作为模态父窗口
 *
 * Electron 模块经 DialogPort / ShellPort 接口注入，便于测试。
 */
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { noopLogger, type Logger } from "@novel/core";
import type { FrontendFileReference } from "@novel/ui";
import type { DesktopFileSelectionOptions } from "../../../shared/index.js";

/** Electron dialog 模块的抽象端口。 */
export interface DesktopDialogPort {
  showOpenDialog(
    options: DesktopDialogOpenOptions,
  ): Promise<readonly string[] | undefined>;
}

export interface DesktopDialogOpenOptions {
  readonly title?: string;
  readonly properties: readonly ("openFile" | "openDirectory" | "multiSelections")[];
  readonly filters?: readonly { readonly name: string; readonly extensions: readonly string[] }[];
}

/** Electron shell 模块的抽象端口。 */
export interface DesktopShellPort {
  openPath(path: string): Promise<string>;
}

/** BrowserWindow 解析端口：根据 senderId 返回父窗口（用于模态 dialog）。 */
export interface DesktopNativeFileWindowResolver {
  resolveParentWindow(senderId: number): { readonly on: () => void } | undefined;
}

export interface DesktopNativeFileServiceOptions {
  readonly dialog: DesktopDialogPort;
  readonly shell: DesktopShellPort;
  readonly logger?: Logger;
}

export interface DesktopNativeFileServicePort {
  selectFile(
    senderId: number,
    options?: DesktopFileSelectionOptions,
  ): Promise<readonly FrontendFileReference[]>;
  selectDirectory(
    senderId: number,
    options?: DesktopFileSelectionOptions,
  ): Promise<readonly FrontendFileReference[]>;
  previewFile(senderId: number, referenceId: string): Promise<void>;
  releaseSender(senderId: number): Promise<void>;
}

interface FileReferenceEntry {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly mediaType?: string;
}

export class DesktopNativeFileService implements DesktopNativeFileServicePort {
  private readonly dialog: DesktopDialogPort;
  private readonly shell: DesktopShellPort;
  private readonly logger: Logger;
  private readonly references = new Map<number, Map<string, FileReferenceEntry>>();

  constructor(options: DesktopNativeFileServiceOptions) {
    this.dialog = options.dialog;
    this.shell = options.shell;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_native_file_service",
    });
  }

  async selectFile(
    senderId: number,
    options?: DesktopFileSelectionOptions,
  ): Promise<readonly FrontendFileReference[]> {
    const paths = await this.dialog.showOpenDialog({
      title: "选择文件",
      properties: [
        "openFile",
        ...(options?.multiple === true ? ["multiSelections" as const] : []),
      ],
      filters: buildFilters(options?.accept),
    });
    if (paths === undefined || paths.length === 0) return Object.freeze([]);
    return this.registerReferences(senderId, paths);
  }

  async selectDirectory(
    senderId: number,
    options?: DesktopFileSelectionOptions,
  ): Promise<readonly FrontendFileReference[]> {
    const paths = await this.dialog.showOpenDialog({
      title: "选择目录",
      properties: [
        "openDirectory",
        ...(options?.multiple === true ? ["multiSelections" as const] : []),
      ],
    });
    if (paths === undefined || paths.length === 0) return Object.freeze([]);
    return this.registerReferences(senderId, paths);
  }

  async previewFile(senderId: number, referenceId: string): Promise<void> {
    const entry = this.references.get(senderId)?.get(referenceId);
    if (entry === undefined) {
      throw new DesktopNativeFileError(
        "DESKTOP_NATIVE_FILE_REFERENCE_NOT_FOUND",
        false,
        "File reference is not active",
      );
    }
    const error = await this.shell.openPath(entry.path);
    if (error !== "") {
      throw new DesktopNativeFileError(
        "DESKTOP_NATIVE_FILE_PREVIEW_FAILED",
        true,
        `Failed to preview file: ${error}`,
      );
    }
    this.logger.debug("desktop_native_file.preview_opened", {
      senderId,
      referenceId,
    });
  }

  releaseSender(senderId: number): Promise<void> {
    this.references.delete(senderId);
    this.logger.debug("desktop_native_file.sender_released", { senderId });
    return Promise.resolve();
  }

  private registerReferences(
    senderId: number,
    paths: readonly string[],
  ): readonly FrontendFileReference[] {
    const senderMap = this.getOrCreateSenderMap(senderId);
    const references: FrontendFileReference[] = [];
    for (const path of paths) {
      const id = randomUUID();
      const name = basename(path);
      const entry: FileReferenceEntry = {
        path,
        name,
        size: 0,
        mediaType: guessMediaType(name),
      };
      senderMap.set(id, entry);
      references.push({
        id,
        name: entry.name,
        size: entry.size,
        ...(entry.mediaType !== undefined ? { mediaType: entry.mediaType } : {}),
      });
    }
    this.logger.debug("desktop_native_file.references_registered", {
      senderId,
      count: references.length,
    });
    return Object.freeze(references);
  }

  private getOrCreateSenderMap(
    senderId: number,
  ): Map<string, FileReferenceEntry> {
    const existing = this.references.get(senderId);
    if (existing !== undefined) return existing;
    const created = new Map<string, FileReferenceEntry>();
    this.references.set(senderId, created);
    return created;
  }
}

function buildFilters(
  accept: readonly string[] | undefined,
): readonly { name: string; extensions: readonly string[] }[] | undefined {
  if (accept === undefined || accept.length === 0) return undefined;
  const extensions = accept
    .map((token) => token.replace(/^\./, "").toLowerCase())
    .filter((token) => token.length > 0);
  if (extensions.length === 0) return undefined;
  return Object.freeze([{ name: "Allowed", extensions: Object.freeze(extensions) }]);
}

function guessMediaType(name: string): string | undefined {
  const ext = extname(name).toLowerCase().replace(/^\./, "");
  if (ext.length === 0) return undefined;
  const MAP: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    ts: "text/typescript",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    pdf: "application/pdf",
  };
  return MAP[ext];
}

class DesktopNativeFileError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "DesktopNativeFileError";
  }
}

export { DesktopNativeFileError };
