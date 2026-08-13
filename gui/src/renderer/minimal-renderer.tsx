/**
 * 最小 renderer（React 版）：wrap → NovelApiClient 门面 → 渲染完整 NovelApp。
 * 只 import kkrpc（browser 版）+ @novel/core/client（browser-safe）+ @novel/ui。
 * workspace 用固定内存 stub（默认项目）；config 经 config-rpc 通道接 ConfigServer。
 */
import "./renderer.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expose, wrap } from "kkrpc/remote-refs";
import { electronIpcTransport } from "kkrpc/electron";
import type { NovelApiClient } from "@novel/core/client";
import type { ConfigApi, ConfigMutation } from "@novel/core";
import { emitApprovalsChanged } from "@novel/ui";
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

// renderer 暴露面：main 直接 rpc 调用（审批队列变化通知 → 触发 UI 重拉）
expose(
  { onApprovalsChanged: async () => emitApprovalsChanged() },
  electronIpcTransport({ endpoint: bridge as never, channel: "ui-rpc" }),
);

const configTransport = electronIpcTransport({ endpoint: bridge as never, channel: "config-rpc" });
const configApi = wrap<ConfigApi>(configTransport);
const configurationClient = {
  load: () => configApi.get(),
  mutate: (m: ConfigMutation) => configApi.mutate(m),
};

interface WorkspaceApi {
  pickWorkspace(): Promise<{ referenceId: string; label: string } | undefined>;
  listRecent(): Promise<readonly { id: string; label: string }[]>;
  open(reference: { referenceId: string; label: string }): Promise<{ id: string; label: string }>;
  close(): Promise<void>;
}
const workspaceTransport = electronIpcTransport({ endpoint: bridge as never, channel: "workspace-rpc" });
const workspaceApi = wrap<WorkspaceApi>(workspaceTransport);

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

// workspace 控制器：桥 main 侧目录选择器 + 定位器（经 workspace-rpc）。
const workspaceController = new WorkspaceController({
  sessions: {
    listRecent: () => workspaceApi.listRecent(),
    open: (reference) => workspaceApi.open(reference),
    close: () => workspaceApi.close(),
  },
  picker: {
    pickWorkspace: () => workspaceApi.pickWorkspace(),
  },
});

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("renderer root element 缺失");
}
const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <NovelApp
      api={api}
      platform={platform}
      workspaceController={workspaceController}
      configurationClient={configurationClient}
    />
  </StrictMode>,
);

// 不自动打开：NovelApp 无 current 时显示项目选择页，由用户 chooseAndOpen（走目录选择器）。
