/**
 * 最小 Electron 入口：node 宿主装配（sqlite novel + 子进程 conversation + 门面），经 kkrpc/electron 暴露给 renderer。
 * - novel：SqliteNovelStore 落盘（userData/novel.db）
 * - conversation：spawnConversation 走子进程（desktop-child.mjs，真实 provider）；createOrResume 回退内存回显 loop
 */
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { expose, proxy, wrap, type RPCMessage } from "kkrpc/remote-refs";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  Conversation,
  ConversationManagerServer,
  EventPublisher,
  EventSubscriber,
  FileConversationJournalService,
  CONVERSATION_OUTPUT,
  conversationEventsAddr,
  NOVEL_CHANGED,
  NOVEL_EVENTS_ADDR,
  SqliteNovelStore,
  ConfigServer,
  createNovelApiServer,
  createProcessSpawner,
  electronIpcTransport,
  startConversationManagerWsServer,
  startNovelDbWsServer,
  type AgentLoop,
  type ConversationApprovalDecision,
  type ConversationApprovalRequest,
  type ConversationJournalService,
  type CredentialCipher,
  createConsoleLogger,
  infoLog,
  type LLMessage,
  type NovelStore,
  type LoopEvent,
  type RunContext,
} from "@novel/core";
import { NodeApplicationConfigStore, NodeConfigHomeResolver, NodeWorkspaceStoreLocator } from "@novel/core/node";
import {
  DesktopDesignFileService,
  DesktopDesignIpcController,
  type DesignIpcMain,
} from "./desktop/design/index.js";

// 双构建流程布局兼容（两条流程都受现役启动命令使用）：
// - build-minimal.mjs（根 gui:release / gui:debug）：esbuild CJS 打包到
//   dist/minimal/main.cjs，preload/renderer 同目录；CJS 下 __dirname 原生
//   可用、import.meta 被垫为空对象（fileURLToPath(import.meta.url) 必崩；
//   esbuild 的 import.meta 警告属预期——运行时被 typeof 短路不执行）；
// - gui pnpm build（tsc NodeNext ESM）：main 在 dist/main/、preload 在
//   dist/preload/、renderer 在 dist/minimal/；ESM 下无 __dirname。
// 按「文件实际存在」探测布局，两流程通用；childScript 两种布局同表达式
// （上三级到项目根再进 core/scripts），不变。
const baseDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
const preloadPath = existsSync(join(baseDir, "preload.cjs"))
  ? join(baseDir, "preload.cjs")
  : join(baseDir, "..", "preload", "preload.cjs");
const rendererHtml = existsSync(join(baseDir, "minimal.html"))
  ? join(baseDir, "minimal.html")
  : join(baseDir, "..", "minimal", "minimal.html");
const childScript = join(baseDir, "..", "..", "..", "core", "scripts", "desktop-child.mjs");
const IPC_CHANNEL = "novel-rpc";
const CONFIG_CHANNEL = "config-rpc";
const WORKSPACE_CHANNEL = "workspace-rpc";
const UI_CHANNEL = "ui-rpc";
/** 会话事件火线裸推通道（main → renderer 单向 webContents.send；preload 同名白名单） */
const CONVERSATION_EVENTS_CHANNEL = "conversation-events";

/**
 * 回显 AgentLoop：followup 即时开 run 产 run-start/user.message → assistant.delta×N →
 * assistant.message/run-end → journal 快照落盘（验证流式链路 + journal 语义，无需真实 provider）。
 * 文本含「审批」时经 requestApproval 阻塞等 UI 决策（验证审批域端到端）。
 * 不发 reasoning delta（loop 层已丢弃，见 docs/PRD/gui-performance.md）。
 */
function createEchoLoop(
  conversationId: string,
  journal?: ConversationJournalService,
  requestApproval?: (req: ConversationApprovalRequest) => Promise<ConversationApprovalDecision>,
): AgentLoop {
  let seq = 0;
  const listeners = new Set<(e: LoopEvent) => void>();
  const emit = (e: LoopEvent): void => {
    for (const l of listeners) l(e);
  };
  const now = () => new Date().toISOString();
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  return {
    run: async () => ({ final: { role: "assistant" as const, content: "" }, usage: undefined }),
    followup: (text: string) => {
      // 即时开 run（seq 按输入时序）+ user 消息快照落盘 = 输入 rpc 的持久化回执
      const messages: LLMessage[] = [{ role: "user", content: text }];
      const run: RunContext = {
        seq: ++seq,
        messages,
        ts: now(),
        appendRunMessages: (m) => {
          messages.push(...m);
        },
      };
      emit({ type: "run-start", persist: true, seq: run.seq, runSeq: run.seq, conversationId, ts: now() });
      emit({ type: "user.message", persist: true, seq: run.seq, text, conversationId, ts: now() });

      // 审批路径：阻塞等 UI 决策（sendApprovalRequest 会发 approval.request 事件），
      // 决策回传后按结果收口（approval.resolved 事件由 Conversation 发出）
      if (text.includes("审批") && requestApproval !== undefined) {
        void requestApproval({
          requestId: `approval:${conversationId}:${run.seq}:b1`,
          toolCalls: [
            {
              toolCallId: `echo_${run.seq}`,
              toolName: "CharacterWrite",
              args: JSON.stringify({ values: [{ name: text.replace("审批", "苏眉").trim() || "苏眉" }] }),
            },
          ],
        })
          .then((decision) => {
            const reply = decision.kind === "approve" ? "（回声）已批准" : "（回声）已拒绝";
            messages.push({ role: "assistant", content: reply });
            emit({ type: "assistant.message", persist: true, seq: run.seq, text: reply, conversationId, ts: now() });
            emit({ type: "run-end", persist: true, seq: run.seq, runSeq: run.seq, conversationId, ts: now() });
            void journal?.appendRun(run);
          })
          .catch(() => {
            // 决策通道异常：收口失败回复，避免 run 悬挂
            const reply = "（回声）审批决策通道异常";
            messages.push({ role: "assistant", content: reply });
            emit({ type: "assistant.message", persist: true, seq: run.seq, text: reply, conversationId, ts: now() });
            emit({ type: "run-end", persist: true, seq: run.seq, runSeq: run.seq, conversationId, ts: now() });
            void journal?.appendRun(run);
          });
        return run;
      }

      // 异步排程发射（避免同步批量发完导致 generating 状态对 UI 不可见：
      // React 批量渲染只呈现最终快照；真实 provider 是秒级流不受影响，echo 演示需人工间隔）
      void (async () => {
        // 文本含「正文」时追加示例小说正文（```novel 块），验证正文草稿面板：
        // fence 打开即出现面板 + 闪烁光标，流式填充，完成后显示「复制正文」
        // （思考态已在 C2 移除，不再发 reasoning delta）
        const demoNovel = text.includes("正文")
          ? "\n\n```novel\n沈砚站在地下室的台阶上，手里的手电筒光柱晃了晃。他听见风从墙缝里钻进来的声音，像是什么人在远处叹气。\n\n他数着自己的脚步。七级台阶。墙面是青灰色的砖，砖缝里生着苔藓。但右手边的墙壁上，有一块砖的颜色比周围的都要浅。他伸出手，指腹贴上去，凉的。\n```"
          : "";
        const reply = `（回声）${text}${demoNovel}`;
        for (const ch of reply) {
          emit({ type: "assistant.delta", kind: "text", text: ch, conversationId, ts: now() });
          await sleep(24);
        }
        messages.push({ role: "assistant", content: reply });
        emit({ type: "assistant.message", persist: true, seq: run.seq, text: reply, conversationId, ts: now() });
        emit({ type: "run-end", persist: true, seq: run.seq, runSeq: run.seq, conversationId, ts: now() });
        // 同 seq 重写：assistant 完整快照（与真实 loop 的 journalListener 语义一致）
        void journal?.appendRun(run);
      })();
      return run;
    },
    steer: () => {},
    stop: () => {},
    cancel: () => {},
    onOutputEvent: (l: (e: LoopEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as AgentLoop;
}

/**
 * 从 config 默认 model profile 解析 provider 连接并写入 process.env（子进程 spawn 经 env 继承）。
 * 设置页保存 key 后重启生效（conversation 模式在启动时决定）。
 */
async function applyDefaultProviderEnv(configStore: NodeApplicationConfigStore): Promise<void> {
  const snapshot = await configStore.get();
  const profile =
    snapshot.profiles.find((p) => p.id === snapshot.defaultProfileId) ?? snapshot.profiles[0];
  if (profile === undefined) return;
  const apiKey = await configStore.resolveSecret(profile.credentialRef);
  if (apiKey === undefined) return;
  process.env.NOVEL_PROVIDER_API_KEY = apiKey;
  process.env.NOVEL_PROVIDER_TYPE = profile.provider;
  process.env.NOVEL_PROVIDER_MODEL = profile.model;
  if (profile.baseUrl !== undefined) process.env.NOVEL_PROVIDER_BASE_URL = profile.baseUrl;
  infoLog(`[main] provider resolved from config: ${profile.provider}/${profile.model}`);
}

/** manager：有 provider key 时 spawnConversation 走子进程（真实 provider，novel-db 经 kkrpc/ws）；否则回退内存回显 loop */
function createManager(
  conversationsRoot: string,
  workspaceProvider: () => string | undefined,
  transports: {
    managerWs: { url: string; token: string; onConnected: Parameters<typeof createProcessSpawner>[1]["managerWs"]["onConnected"] };
    novelWs: { url: string; token: string };
  },
): ConversationManagerServer {
  // server 先声明：内存模式 factory 的 managerWait 需闭包引用（进程内直连同一队列）
  let server: ConversationManagerServer | undefined;
  // gui main 无 pino 落盘：console Logger 接审批/mode 关键链路埋点（JSON 行，与 pino 同构）
  const logger = createConsoleLogger();
  const factory = {
    create: (o: { conversationId: string }) => {
      // 回显模式同样落盘：与子进程 journal 语义一致（history/回执互认）。
      // 审批触发经 conv 自引用：requestApproval → conv.sendApprovalRequest（无阻塞提交 + 驻留等待）
      const journal = new FileConversationJournalService({
        conversationId: o.conversationId,
        filePath: join(conversationsRoot, o.conversationId, "journal.jsonl"),
      });
      void journal.open();
      let conv: Conversation | undefined;
      const loop = createEchoLoop(o.conversationId, journal, (req) =>
        conv!.sendApprovalRequest(req),
      );
      conv = new Conversation({
        conversationId: o.conversationId,
        loop,
        sampling: { model: "echo" },
        journal,
        logger,
        // 内存模式：wait 提交走进程内 CMS 队列（与子进程同路由）；超时仅解除等待不退出
        managerWait: {
          submitApproval: (id, req) => server!.submitApprovalRequest(id, req),
          submitAsking: (id, req) => server!.submitAskingRequest(id, req),
          submitExitCompose: (id, req) => server!.submitExitComposeRequest(id, req),
        },
      });
      return conv;
    },
  };
  const spawner =
    process.env.NOVEL_PROVIDER_API_KEY !== undefined
      ? createProcessSpawner(childScript, {
          managerWs: {
            url: transports.managerWs.url,
            token: transports.managerWs.token,
            onConnected: transports.managerWs.onConnected,
          },
          novelWs: transports.novelWs,
        })
      : undefined;
  server = new ConversationManagerServer(factory, spawner, {
    storedirRoot: conversationsRoot,
    workspaceProvider,
    logger,
  });
  return server;
}

// 崩溃兜底：main 进程任何未捕获异常/未处理 rejection 先留完整痕迹再退出
// （此前无此 handler 时崩溃只剩 exit 1 + 一行裸 undefined，无法定位）
process.on("uncaughtException", (e) => {
  console.error("[main] uncaught exception:", e);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandled rejection:", reason);
  process.exit(1);
});

async function main(): Promise<void> {
  await app.whenReady();

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "文件", submenu: [{ role: "quit", label: "退出" }] },
      {
        label: "编辑",
        submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }],
      },
      {
        label: "视图",
        submenu: [{ role: "reload" }, { role: "toggleDevTools" }],
      },
    ]),
  );

  const store = new SqliteNovelStore(join(app.getPath("userData"), "novel.db"));

  // novel.changed 广播：ZeroMQ PUB/SUB（mutate 成功 → publish；订阅 → rpc 通知 renderer 刷新）
  const novelPublisher = new EventPublisher(NOVEL_EVENTS_ADDR);
  await novelPublisher.bind();
  const publishingStore: NovelStore = {
    query: (q) => store.query(q),
    mutate: async (m) => {
      const result = await store.mutate(m);
      novelPublisher.publish(NOVEL_CHANGED, {
        type: "novel.changed",
        op: m.op,
        entity: result.entity,
        id: result.changeId,
        version: result.version,
        ts: new Date().toISOString(),
      });
      return result;
    },
  };
  const conversationsRoot = join(app.getPath("userData"), "novel-storage", "conversations");

  // config：JSON 文件持久化（凭据暂明文，safeStorage cipher 后续接）
  const configHome = new NodeConfigHomeResolver(app.getPath("userData"));
  const plaintextCipher: CredentialCipher = {
    encrypt: async (secret) => secret,
    decrypt: async (ciphertext) => ciphertext,
  };
  const configStore = new NodeApplicationConfigStore({
    filePath: join(configHome.resolve(), "config.json"),
    cipher: plaintextCipher,
  });
  await configStore.load();
  const configServer = new ConfigServer(configStore);

  // provider 配置：默认 model profile 的凭据解析为子进程 env（NOVEL_PROVIDER_*）。
  // 设置页保存后重启生效（conversation 模式在启动时决定）。
  await applyDefaultProviderEnv(configStore);

  // novel-db WS：conversation 子进程经 kkrpc/ws + token 访问 canonical store（协议定稿 transport）
  const novelWs = await startNovelDbWsServer({ store: publishingStore, token: randomUUID() });

  // manager WS（conversation ↔ CMS 单连接双工；manager 与服务端互依 → holder）
  const managerHolder: { manager?: ConversationManagerServer } = {};
  const managerWs = await startConversationManagerWsServer({
    manager: () => managerHolder.manager!,
    token: randomUUID(),
  });

  // 当前工作区根路径（spawn 时经 env 注入子进程，agent 文件工具落点）
  let currentWorkspaceRoot: string | undefined;
  const manager = createManager(conversationsRoot, () => currentWorkspaceRoot, {
    managerWs: {
      url: managerWs.url,
      token: managerWs.token,
      onConnected: (listener) => managerWs.onConversationConnected(listener),
    },
    novelWs: { url: novelWs.url, token: novelWs.token },
  });
  managerHolder.manager = manager;
  // wait 队列变化 → 通知 renderer（Phase B 接线 onApprovalsChanged；此处留 hook）
  const uiNotifyHolder: { notify?: () => void } = {};
  manager.onWaitChange(() => {
    uiNotifyHolder.notify?.();
  });
  const serverApi = createNovelApiServer({ manager, novel: publishingStore, proxy, journalDir: conversationsRoot });

  // 主窗口引用（IPC sender 校验 + 定向发送；窗口创建晚于端点注册）
  let mainWindow: BrowserWindow | undefined;

  // kkrpc/electron 传输端点（main 侧：webContents.send / ipcMain.on）。
  // 安全：入站消息仅接受主窗口 sender（防注入 frame/webview 冒名调用）；
  // 出站定向主窗口（不广播所有窗口，防串窗）
  const endpoint = {
    send: (channel: string, msg: RPCMessage) => {
      const win = mainWindow;
      if (win !== undefined && !win.isDestroyed()) win.webContents.send(channel, msg);
    },
    on: (channel: string, listener: (_event: unknown, msg: RPCMessage) => void) => {
      ipcMain.on(channel, (event, msg) => {
        if (mainWindow === undefined || event.sender !== mainWindow.webContents) return;
        listener(event, msg);
      });
    },
    off: (channel: string, listener: (_event: unknown, msg: RPCMessage) => void) => {
      ipcMain.off(channel, listener);
    },
  };
  expose(serverApi, electronIpcTransport({ endpoint, channel: IPC_CHANNEL }));
  await configServer.start(electronIpcTransport({ endpoint, channel: CONFIG_CHANNEL }));

  // renderer 暴露面（main 直接 rpc 调用：审批队列变化 / novel 数据变更通知）
  const uiApi = wrap<{
    onApprovalsChanged(): Promise<void>;
    onNovelChanged(change: { entity: string }): Promise<void>;
  }>(
    electronIpcTransport({ endpoint, channel: UI_CHANNEL }),
  );
  uiNotifyHolder.notify = () => {
    void uiApi.onApprovalsChanged().catch(() => {
      // renderer 未就绪/已关窗时忽略
    });
  };
  // novel.changed 订阅：ZeroMQ → renderer 通知（拉取为准，通知仅触发刷新）
  const novelSubscriber = new EventSubscriber(NOVEL_EVENTS_ADDR, [NOVEL_CHANGED]);
  await novelSubscriber.connect();
  void (async () => {
    try {
      for await (const message of novelSubscriber) {
        const entity = (message.payload as { entity?: unknown } | null)?.entity;
        if (typeof entity !== "string") continue;
        void uiApi.onNovelChanged({ entity }).catch(() => {
          // renderer 未就绪时忽略（store 下次 loadWorkspace 兜底）
        });
      }
    } catch (e) {
      console.error("[main] novel subscriber stopped:", e);
    }
  })();

  // 会话事件火线（gui-performance-2 功能点八）：child 侧每会话一个 ZMQ PUB
  // （ipc://conversation-{id}-events，register 时已 bind）；main 在 register 报到后
  // SUB 接入，逐帧裸转发 renderer（无 kkrpc 远端回调往返）。会话进程退出拆除 SUB。
  const conversationSubscribers = new Map<string, EventSubscriber>();
  manager.onRegistered((conversationId) => {
    if (conversationSubscribers.has(conversationId)) return;
    const subscriber = new EventSubscriber(conversationEventsAddr(conversationId), [CONVERSATION_OUTPUT]);
    conversationSubscribers.set(conversationId, subscriber);
    void (async () => {
      try {
        await subscriber.connect();
        for await (const message of subscriber) {
          const win = mainWindow;
          if (win === undefined || win.isDestroyed()) continue;
          win.webContents.send(CONVERSATION_EVENTS_CHANNEL, message.payload);
        }
      } catch (e) {
        console.error(`[main] conversation subscriber stopped (${conversationId}):`, e);
      }
    })();
  });
  manager.onConversationExited((conversationId) => {
    const subscriber = conversationSubscribers.get(conversationId);
    conversationSubscribers.delete(conversationId);
    if (subscriber !== undefined) void subscriber.close().catch(() => {});
  });

  // 退出前有序关闭：zeromq 原生插件（addon.node）在进程退出时若 socket 未干净拆除会
  // fail-fast（0xC0000409，Event Log 已确认）。will-quit 先 preventDefault，等全部
  // close（含 SUB socket，其关闭令上方 for-await 自然结束）完成后再真正 quit；
  // 2s 兜底超时防 close 悬挂导致应用退不掉。
  let shutdownReady = false;
  app.on("will-quit", (e) => {
    if (shutdownReady) return;
    e.preventDefault();
    shutdownReady = true;
    void Promise.race([
      Promise.allSettled([
        novelPublisher.close(),
        novelSubscriber.close(),
        novelWs.close(),
        managerWs.close(),
      ]),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).finally(() => app.quit());
  });

  // workspace：目录选择器 + 定位器 + 最近列表（内存）
  const locator = new NodeWorkspaceStoreLocator({
    storageRoot: join(app.getPath("userData"), "novel-storage"),
  });
  const recentWorkspaces: { id: string; label: string }[] = [];
  // 允许 open 的 referenceId 白名单：仅 pickWorkspace（原生目录对话框）返回的路径可设为工作区，
  // 渲染进程直传任意路径会被拒绝（防渲染端被污染后把 agent 文件工具指向任意目录）
  const allowedWorkspaceReferences = new Set<string>();
  const workspaceApi = {
    pickWorkspace: async (): Promise<{ referenceId: string; label: string } | undefined> => {
      const result = await dialog.showOpenDialog({
        title: "打开小说项目",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return undefined;
      const root = result.filePaths[0]!;
      allowedWorkspaceReferences.add(root);
      return { referenceId: root, label: basename(root) };
    },
    listRecent: async () => Object.freeze([...recentWorkspaces]),
    open: async (reference: { referenceId: string; label: string }) => {
      if (!allowedWorkspaceReferences.has(reference.referenceId)) {
        throw new Error(`未授权的 workspace 引用（请先经目录选择器打开）: ${reference.referenceId}`);
      }
      const location = await locator.resolve(reference.referenceId);
      const session = { id: location.workspaceId, label: reference.label };
      recentWorkspaces.unshift(session);
      currentWorkspaceRoot = location.workspaceRoot;
      return session;
    },
    close: async () => {
      currentWorkspaceRoot = undefined;
    },
  };
  expose(workspaceApi, electronIpcTransport({ endpoint, channel: WORKSPACE_CHANNEL }));

  // 自绘窗口控制（PRD WC/决议5）：Windows 全 frameless；macOS 保留系统红绿灯
  // （titleBarStyle hidden）。最小窗口 1080×640（决议 6：断点收敛 1280/1080 两档），
  // 初始 1280×800。
  const isDarwin = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 640,
    ...(isDarwin
      ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 13, y: 13 } }
      : { frame: false }),
    webPreferences: {
      preload: preloadPath,
      // 显式安全声明（Electron 当前默认即此值；显式化防升级/配置漂移后静默回退）
      contextIsolation: true,
      nodeIntegration: false,
      // 失焦/最小化时不节流 renderer 定时器（gui-performance-2 功能点七）：
      // 32ms 流式发布节流依赖 setTimeout，系统级节流会导致后台流式冻结、
      // 恢复焦点时跳变追帧
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  // 窗口控制 IPC（window-controls:*）：仅主窗口 webContents 授权；
  // macOS 用系统红绿灯，renderer 侧不请求窗控（preload 仍暴露桥，win 才接 UI）
  const WINDOW_CONTROLS_CHANNEL = {
    minimize: "window-controls:minimize",
    toggleMaximize: "window-controls:toggle-maximize",
    close: "window-controls:close",
    state: "window-controls:maximized",
  } as const;
  const isMainWindowSender = (senderId: number): boolean => senderId === win.webContents.id;
  ipcMain.on(WINDOW_CONTROLS_CHANNEL.minimize, (event) => {
    if (isMainWindowSender(event.sender.id)) win.minimize();
  });
  ipcMain.on(WINDOW_CONTROLS_CHANNEL.toggleMaximize, (event) => {
    if (!isMainWindowSender(event.sender.id)) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(WINDOW_CONTROLS_CHANNEL.close, (event) => {
    if (isMainWindowSender(event.sender.id)) win.close();
  });
  const sendMaximizedState = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(WINDOW_CONTROLS_CHANNEL.state, win.isMaximized());
    }
  };
  win.on("maximize", sendMaximizedState);
  win.on("unmaximize", sendMaximizedState);
  win.webContents.once("did-finish-load", sendMaximizedState);
  // compose 设计草稿文件 IPC（novel.design.v1.*）：仅主窗口 webContents 授权，
  // workspace 根随当前打开项目切换；renderer 经 preload novelDesign.invoke 调用
  const designController = new DesktopDesignIpcController({
    service: new DesktopDesignFileService({
      resolveWorkspaceRoot: (senderId) =>
        senderId === win.webContents.id ? currentWorkspaceRoot : undefined,
    }),
    authorizeSender: (senderId) => senderId === win.webContents.id,
  });
  designController.register(ipcMain as unknown as DesignIpcMain);
  win.on("closed", () => {
    void designController.dispose();
  });
  win.webContents.on("console-message", (_e, ...args: unknown[]) => {
    // Electron 43 新旧签名兼容：旧 (event, level, message, ...) / 新 (event, details)
    const first = args[0];
    const level =
      typeof first === "object" && first !== null && "level" in first
        ? (first as { level: unknown }).level
        : first;
    const message =
      typeof first === "object" && first !== null && "message" in first
        ? (first as { message: unknown }).message
        : args[1];
    // 按级别分流：error/warning 进 stderr，info 级不再污染错误输出
    if (level === 3 || level === "error") console.error(`[renderer] ${String(message)}`);
    else if (level === 2 || level === "warning") console.warn(`[renderer] ${String(message)}`);
  });
  await win.loadFile(rendererHtml);
  infoLog("[main] minimal electron ready");
}

main().catch((e) => {
  console.error("[main] failed", e);
  app.quit();
});
