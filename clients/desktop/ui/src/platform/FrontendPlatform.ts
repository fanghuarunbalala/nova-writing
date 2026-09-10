/** Platform-neutral browser and desktop capabilities injected into shared UI. */
import type { ConversationPlatformEventSource } from "@novel/core/client";

export interface PlatformCapabilities {
  readonly fileSelection: boolean;
  readonly clipboardRead: boolean;
  readonly clipboardWrite: boolean;
  readonly notifications: boolean;
  /** 书库视图（试验功能）：仅 debug 构建开启；缺省 false 隐藏第四视图 */
  readonly library?: boolean;
}

export interface FrontendFileReference {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly mediaType?: string;
}

export interface SelectFrontendFilesRequest {
  readonly multiple?: boolean;
  readonly accept?: readonly string[];
}

export interface FileSelectionPort {
  selectFiles(
    request?: SelectFrontendFilesRequest,
  ): Promise<readonly FrontendFileReference[]>;
}

export interface ClipboardPort {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export interface FrontendNotificationRequest {
  readonly title: string;
  readonly body?: string;
  readonly tag?: string;
}

export interface NotificationPort {
  show(request: FrontendNotificationRequest): Promise<void>;
}

/** 设计草稿文件端口：compose 模式下读取/写回 design 文件。 */
/** Design-file port: read/write the design draft in compose mode. */
export interface DesignFilePort {
  read(conversationId: string): Promise<string>;
  write(conversationId: string, content: string): Promise<void>;
}

export interface FrontendPlatform {
  readonly capabilities: PlatformCapabilities;
  readonly files: FileSelectionPort;
  readonly clipboard: ClipboardPort;
  readonly notifications: NotificationPort;
  /** compose 设计草稿文件能力；缺失时 UI 降级为只读提示。 */
  /** Compose design-file capability; the UI degrades to a read-only note when absent. */
  readonly designFile?: DesignFilePort;
  /**
   * 会话事件推送源（Electron ZMQ 火线的 renderer 侧形态；gui-performance-2
   * 功能点八）。缺失时投影回退 kkrpc subscribeEvents（测试/浏览器）。
   */
  readonly conversationEvents?: ConversationPlatformEventSource;
}
