/**
 * 最小 renderer（React 版）：wrap → NovelApiClient 门面 → 渲染完整 NovelApp。
 * 只 import kkrpc（browser 版）+ @novel/core/client（browser-safe）+ @novel/ui。
 * workspace 用固定内存 stub（默认项目）；config 经 config-rpc 通道接 ConfigServer。
 */
import "./renderer.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { expose, wrap } from "kkrpc/remote-refs";
import { electronIpcTransport } from "kkrpc/electron";
import type { NovelApiClient } from "@novel/core/client";
import type { ProjectedEvent } from "@novel/core";
import type { ConfigApi, ConfigMutation } from "@novel/core";
import { emitApprovalsChanged, emitAskingsChanged, emitNovelChanged } from "@novel/ui";
import {
  NovelApp,
  WorkspaceController,
  type FrontendPlatform,
  type WindowChromeProps,
} from "@novel/ui";
import { createElectronDesignFilePort } from "./platform/index.js";

declare global {
  interface Window {
    novelApi: { bridge: unknown };
    novelDesign?: {
      read(conversationId: string): Promise<unknown>;
      write(conversationId: string, content: string): Promise<unknown>;
    };
    novelEvents?: {
      onConversationEvent: (callback: (payload: unknown) => void) => () => void;
    };
    novelWindow?: {
      platform: "win" | "mac";
      minimize(): void;
      toggleMaximize(): void;
      close(): void;
      onMaximizedChange(callback: (maximized: boolean) => void): () => void;
    };
  }
}

const bridge = (window.novelApi as { bridge?: unknown } | undefined)?.bridge;
if (!bridge) {
  throw new Error("window.novelApi.bridge 未暴露（preload 未生效？）");
}
const transport = electronIpcTransport({ endpoint: bridge as never, channel: "novel-rpc" });
const api = wrap<NovelApiClient>(transport);

// renderer 暴露面：main 直接 rpc 调用（审批/提问队列变化 / novel 数据变更通知 → 触发 UI 刷新）
expose(
  {
    onApprovalsChanged: async () => emitApprovalsChanged(),
    onAskingsChanged: async () => emitAskingsChanged(),
    onNovelChanged: async (change: { entity: string }) => emitNovelChanged(change.entity),
  },
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
  // 设计草稿文件端口：preload novelDesign 桥存在时装配（旧 preload 缺省降级——DesignCard 只读提示）
  ...(window.novelDesign === undefined
    ? {}
    : { designFile: createElectronDesignFilePort({ design: window.novelDesign as never }) }),
  // 会话事件火线（gui-performance-2 功能点八）：preload 裸推通道 → 投影平台事件源
  // （payload = {conversationId, event}；按会话过滤后交付）。缺失时投影回退 kkrpc。
  ...(window.novelEvents !== undefined
    ? {
        conversationEvents: {
          subscribe: (
            conversationId: string,
            listener: (event: ProjectedEvent) => void,
          ): (() => void) =>
            window.novelEvents!.onConversationEvent((payload) => {
              const envelope = payload as { conversationId?: string; event?: ProjectedEvent } | null;
              if (envelope?.conversationId === conversationId && envelope.event !== undefined) {
                listener(envelope.event);
              }
            }),
        },
      }
    : {}),
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

// 窗口控制（PRD WC）：preload novelWindow 桥存在时装配 WindowChromeProps
// （macOS 系统红绿灯在 titleBarStyle:hidden 下由系统渲染，UI 侧不再自绘）。
const novelWindow = window.novelWindow;
const useWindowChrome = (): WindowChromeProps | undefined => {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (novelWindow === undefined) return;
    return novelWindow.onMaximizedChange(setMaximized);
  }, []);
  if (novelWindow === undefined || novelWindow.platform === "mac") return undefined;
  return {
    platform: "win",
    maximized,
    onMinimize: () => novelWindow.minimize(),
    onToggleMaximize: () => novelWindow.toggleMaximize(),
    onClose: () => novelWindow.close(),
  };
};

function AppRoot() {
  const windowChrome = useWindowChrome();
  return (
    <StrictMode>
      <NovelApp
        api={api}
        platform={platform}
        workspaceController={workspaceController}
        configurationClient={configurationClient}
        windowChrome={windowChrome}
      />
    </StrictMode>
  );
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("renderer root element 缺失");
}
const root = createRoot(rootElement);
root.render(<AppRoot />);

// 不自动打开：NovelApp 无 current 时显示项目选择页，由用户 chooseAndOpen（走目录选择器）。
