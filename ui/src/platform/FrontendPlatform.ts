/** Platform-neutral browser and desktop capabilities injected into shared UI. */
export interface PlatformCapabilities {
  readonly fileSelection: boolean;
  readonly clipboardRead: boolean;
  readonly clipboardWrite: boolean;
  readonly notifications: boolean;
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

export interface FrontendPlatform {
  readonly capabilities: PlatformCapabilities;
  readonly files: FileSelectionPort;
  readonly clipboard: ClipboardPort;
  readonly notifications: NotificationPort;
}
