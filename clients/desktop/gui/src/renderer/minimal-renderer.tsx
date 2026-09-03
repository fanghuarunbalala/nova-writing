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
import type { Logger, ProjectedEvent } from "@novel/core";
import type { ConfigApi, ConfigMutation, ConnectionTestInput, McpServerInput } from "@novel/core";
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
      /** server 认证状态推送（preload 已暴露；payload = ServerAuthState） */
      onServerAuthChange?: (callback: (state: unknown) => void) => () => void;
    };
    novelWindow?: {
      platform: "win" | "mac";
      minimize(): void;
      toggleMaximize(): void;
      close(): void;
      onMaximizedChange(callback: (maximized: boolean) => void): () => void;
    };
    __NOVEL_DEBUG__?: boolean;
    __NOVEL_LIBRARY_ENABLED__?: boolean;
  }
}

// 启动计时里程碑（console.info 经 main 的 console-message 桥按 [boot] 前缀转发）：
// 此处 = import 图（@novel/ui barrel 全域）求值完成
console.info("[boot] renderer modules evaluated");

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
  test: (input: ConnectionTestInput) => configApi.test(input),
  // provider 运行形态（启动时快照）：旧 server 未暴露方法/查询失败回退 live=true（维持现状文案）
  runtimeStatus: async () => {
    try {
      return (await configApi.getRuntimeStatus?.()) ?? { providerLive: true };
    } catch {
      return { providerLive: true };
    }
  },
  // 技能清单（main 实时扫描两级 skills 目录）：旧 server 未暴露时 undefined → 面板显示未装配
  skillsList: () => configApi.skillsList?.(),
  // MCP 测试连接（main 临时连接 initialize + tools/list）：旧 server 未暴露时 undefined → 隐藏按钮
  testMcp: (input: McpServerInput) => configApi.testMcp?.(input),
  // server 模式认证（main 侧 ServerAuthSession；旧 server 未暴露时 undefined → 面板隐藏表单外的功能）
  serverAuth: () => configApi.serverAuth?.(),
  serverLogin: (url: string, username: string, password: string) => configApi.serverLogin?.(url, username, password),
  serverRegister: (url: string, username: string, password: string) => configApi.serverRegister?.(url, username, password),
  serverLogout: () => configApi.serverLogout?.(),
  serverDevices: () => configApi.serverDevices?.(),
  serverKickDevice: (deviceId: string) => configApi.serverKickDevice?.(deviceId),
};

interface WorkspaceSessionDto {
  id: string;
  label: string;
  /** registry 透传：最后打开时间（ISO）与工作区根目录（旧数据缺省） */
  lastOpenedAt?: string;
  rootPath?: string;
}
interface WorkspaceApi {
  pickWorkspace(): Promise<{ referenceId: string; label: string } | undefined>;
  /** 新建项目：save 型对话框命名 → 主进程建目录 → 返回引用 */
  createWorkspace(): Promise<{ referenceId: string; label: string } | undefined>;
  listRecent(): Promise<readonly WorkspaceSessionDto[]>;
  open(reference: { referenceId: string; label: string }): Promise<WorkspaceSessionDto>;
  close(): Promise<void>;
  /** 在新 GUI 实例中打开（当前实例不动；已打开时主进程弹窗告知并置前持有窗口） */
  openInNewWindow(reference: { referenceId: string; label: string }): Promise<void>;
  /** 取出"新窗口打开"派发的启动项目（取出即清，仅一次） */
  takeStartupWorkspace(): Promise<{ referenceId: string; label: string } | undefined>;
  /** 新手引导完成标记（主进程文件，跨实例一致可见） */
  getOnboardingDone(): Promise<boolean>;
  markOnboardingDone(): Promise<void>;
  /** 删除项目（仅非当前项目；主进程彻底删除应用侧 storeDir 并移出注册表） */
  delete(workspaceId: string): Promise<void>;
}
const workspaceTransport = electronIpcTransport({ endpoint: bridge as never, channel: "workspace-rpc" });
const workspaceApi = wrap<WorkspaceApi>(workspaceTransport);

const platform: FrontendPlatform = {
  capabilities: {
    fileSelection: false,
    clipboardRead: false,
    clipboardWrite: false,
    notifications: false,
    // 试验功能门控：书库视图仅显式开关（NOVEL_LIBRARY=1）开启——release/debug 默认均隐藏
    library: window.__NOVEL_LIBRARY_ENABLED__ === true,
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
// openInNewWindow/takeStartupWorkspace：切换对话框"新窗口打开"两件套（派发 + 启动自动打开）。
const workspaceController = new WorkspaceController({
  sessions: {
    listRecent: () => workspaceApi.listRecent(),
    open: (reference) => workspaceApi.open(reference),
    close: () => workspaceApi.close(),
    openInNewWindow: (reference) => workspaceApi.openInNewWindow(reference),
    takeStartupWorkspace: () => workspaceApi.takeStartupWorkspace(),
    deleteWorkspace: (workspaceId) => workspaceApi.delete(workspaceId),
  },
  picker: {
    pickWorkspace: () => workspaceApi.pickWorkspace(),
    createWorkspace: () => workspaceApi.createWorkspace(),
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

// renderer console logger（此前 NovelApp 缺省 noopLogger，renderer 侧日志全部丢失）：
// 输出 renderer console；warn/error 经 main 的 console-message 桥转发到主进程 stderr。
const rendererLogger: Logger = {
  trace: () => {},
  debug: (event, fields) => console.debug(`[renderer] ${event}`, fields ?? ""),
  info: (event, fields) => console.info(`[renderer] ${event}`, fields ?? ""),
  warn: (event, fields) => console.warn(`[renderer] ${event}`, fields ?? ""),
  error: (event, fields) => console.error(`[renderer] ${event}`, fields ?? ""),
  child: (bindings) => ({
    ...rendererLogger,
    debug: (event, fields) => rendererLogger.debug(event, { ...bindings, ...fields }),
    info: (event, fields) => rendererLogger.info(event, { ...bindings, ...fields }),
    warn: (event, fields) => rendererLogger.warn(event, { ...bindings, ...fields }),
    error: (event, fields) => rendererLogger.error(event, { ...bindings, ...fields }),
  }),
  flush: async () => {},
  close: async () => {},
};

// 引导完成标记端口：localStorage 多实例互不可见 → 主进程文件持久化（NovelApp 门控用）
const onboardingPort = {
  isCompleted: () => workspaceApi.getOnboardingDone(),
  markCompleted: () => workspaceApi.markOnboardingDone(),
};

function AppRoot() {
  const windowChrome = useWindowChrome();
  useEffect(() => {
    // 首帧 UI commit 后触发（useEffect 在 paint 后）：此前的窗口期由页内 boot-placeholder 覆盖
    console.info("[boot] app mounted");
  }, []);
  return (
    <StrictMode>
      <NovelApp
        api={api}
        logger={rendererLogger}
        platform={platform}
        workspaceController={workspaceController}
        configurationClient={configurationClient}
        onboardingPort={onboardingPort}
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
console.info("[boot] react root render start");
root.render(<AppRoot />);

// 不自动打开：NovelApp 无 current 时显示项目选择页，由用户 chooseAndOpen（走目录选择器）。
