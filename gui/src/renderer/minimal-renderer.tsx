/**
 * 最小 renderer（React 版）：wrap → NovelApiClient 门面 → 渲染完整 NovelApp。
 * 只 import kkrpc（browser 版）+ @novel/core/client（browser-safe）+ @novel/ui。
 * workspace 用固定内存 stub（默认项目），config 客户端暂缺省。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { wrap } from "kkrpc";
import { electronIpcTransport } from "kkrpc/electron";
import type { NovelApiClient } from "@novel/core/client";
import {
  NovelApp,
  WorkspaceController,
  type FrontendPlatform,
} from "@novel/ui";

declare global {
  interface Window {
    novelApi: { bridge: unknown };
  }
}

const bridge = (window.novelApi as { bridge?: unknown } | undefined)?.bridge;
if (!bridge) {
  throw new Error("window.novelApi.bridge 未暴露（preload 未生效？）");
}
const transport = electronIpcTransport({ endpoint: bridge as never, channel: "novel-rpc" });
const api = wrap<NovelApiClient>(transport);

const platform: FrontendPlatform = {
  capabilities: {
    fileSelection: false,
    clipboardRead: false,
    clipboardWrite: false,
    notifications: false,
  },
  files: { selectFiles: async () => Object.freeze([]) },
  clipboard: { readText: async () => "", writeText: async () => {} },
  notifications: { show: async () => {} },
};

// 固定内存 workspace（默认项目）；生产换 ElectronWorkspaceController + bridge.workspaces。
const workspaceController = new WorkspaceController({
  sessions: {
    listRecent: async () => Object.freeze([Object.freeze({ id: "default", label: "默认项目" })]),
    open: async (reference) => ({ id: reference.referenceId, label: reference.label }),
    close: async () => {},
  },
  picker: {
    pickWorkspace: async () => ({ referenceId: "default", label: "默认项目" }),
  },
});

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("renderer root element 缺失");
}
const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <NovelApp api={api} platform={platform} workspaceController={workspaceController} />
  </StrictMode>,
);

// 自动打开默认项目（NovelApp 无 current workspace 时显示选择页）。
void workspaceController.openRecent("default");
