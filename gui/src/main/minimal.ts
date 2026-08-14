/**
 * 最小 Electron 入口：node 宿主装配（sqlite novel + 子进程 conversation + 门面），经 kkrpc/electron 暴露给 renderer。
 * - novel：SqliteNovelStore 落盘（userData/novel.db）
 * - conversation：spawnConversation 走子进程（desktop-child.mjs，真实 provider）；createOrResume 回退内存回显 loop
 */
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { expose, proxy, wrap, type RPCMessage } from "kkrpc/remote-refs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  Conversation,
  ConversationManagerServer,
  EventPublisher,
  EventSubscriber,
  FileConversationJournalService,
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
  debugLog,
  infoLog,
  type LLMessage,
  type NovelStore,
  type OutputEvent,
  type TurnContext,
} from "@novel/core";
import { NodeApplicationConfigStore, NodeConfigHomeResolver, NodeWorkspaceStoreLocator } from "@novel/core/node";

// ESM 下无 __dirname：以 import.meta.url 推导（= gui/dist/main）；
// preload 在 dist/preload、renderer 在 dist/minimal；childScript 上三级到项目根再进 core/scripts
const __dirname = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(__dirname, "..", "preload", "preload.cjs");
const rendererHtml = join(__dirname, "..", "minimal", "minimal.html");
const childScript = join(__dirname, "..", "..", "..", "core", "scripts", "desktop-child.mjs");
const IPC_CHANNEL = "novel-rpc";
const CONFIG_CHANNEL = "config-rpc";
const WORKSPACE_CHANNEL = "workspace-rpc";
const UI_CHANNEL = "ui-rpc";

/**
 * 回显 AgentLoop：followup 即时开 turn 产 turn-start/user.message → assistant.delta×N →
 * assistant.message/turn-end → journal 快照落盘（验证流式链路 + journal 语义，无需真实 provider）。
 * 文本含「思考」时先发 reasoning delta（验证 thinking 态）；含「审批」时经 requestApproval
 * 阻塞等 UI 决策（验证审批域端到端）。
 */
function createEchoLoop(
  conversationId: string,
  journal?: ConversationJournalService,
  requestApproval?: (req: ConversationApprovalRequest) => Promise<ConversationApprovalDecision>,
): AgentLoop {
  let seq = 0;
  const listeners = new Set<(e: OutputEvent) => void>();
  const emit = (e: OutputEvent): void => {
    for (const l of listeners) l(e);
  };
  const now = () => new Date().toISOString();
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  return {
    run: async () => ({ final: { role: "assistant" as const, content: "" }, usage: undefined }),
    followup: (text: string) => {
      // 即时开 turn（seq 按输入时序）+ user 消息快照落盘 = 输入 rpc 的持久化回执
      const messages: LLMessage[] = [{ role: "user", content: text }];
      const turn: TurnContext = {
        seq: ++seq,
        messages,
        ts: now(),
        appendTurnMessages: (m) => {
          messages.push(...m);
        },
      };
      emit({ type: "turn-start", persist: true, seq: turn.seq, turnSeq: turn.seq, conversationId, ts: now() });
      emit({ type: "user.message", persist: true, seq: turn.seq, text, conversationId, ts: now() });

      // 审批路径：阻塞等 UI 决策（sendApprovalRequest 会发 approval.request 事件），
      // 决策回传后按结果收口（approval.resolved 事件由 Conversation 发出）
      if (text.includes("审批") && requestApproval !== undefined) {
        void requestApproval({
          requestId: `approval_${conversationId}_${turn.seq}_echo`,
          toolName: "CharacterWrite",
          args: JSON.stringify({ values: [{ name: text.replace("审批", "苏眉").trim() || "苏眉" }] }),
        })
          .then((decision) => {
            const reply = decision.kind === "approve" ? "（回声）已批准" : "（回声）已拒绝";
            messages.push({ role: "assistant", content: reply });
            emit({ type: "assistant.message", persist: true, seq: turn.seq, text: reply, conversationId, ts: now() });
            emit({ type: "turn-end", persist: true, seq: turn.seq, turnSeq: turn.seq, conversationId, ts: now() });
            void journal?.appendTurn(turn);
          })
          .catch(() => {
            // 决策通道异常：收口失败回复，避免 turn 悬挂
            const reply = "（回声）审批决策通道异常";
            messages.push({ role: "assistant", content: reply });
            emit({ type: "assistant.message", persist: true, seq: turn.seq, text: reply, conversationId, ts: now() });
            emit({ type: "turn-end", persist: true, seq: turn.seq, turnSeq: turn.seq, conversationId, ts: now() });
            void journal?.appendTurn(turn);
          });
        return turn;
      }

      // 异步排程发射（避免同步批量发完导致 thinking/generating 状态对 UI 不可见：
      // React 批量渲染只呈现最终快照；真实 provider 是秒级流不受影响，echo 演示需人工间隔）
      void (async () => {
        // 文本含「思考」时先发 reasoning delta（验证 thinking 呼吸动画；内容默认丢弃不进正文）
        if (text.includes("思考")) {
          emit({ type: "assistant.delta", persist: false, kind: "reasoning", text: "让我想想…", conversationId, ts: now() });
          await sleep(700);
          emit({ type: "assistant.delta", persist: false, kind: "reasoning", text: "分析文本结构…", conversationId, ts: now() });
          await sleep(700);
        }
        // 文本含「正文」时追加示例小说正文（```novel 块），验证正文草稿面板：
        // fence 打开即出现面板 + 闪烁光标，流式填充，完成后显示「复制正文」
        const demoNovel = text.includes("正文")
          ? "\n\n```novel\n沈砚站在地下室的台阶上，手里的手电筒光柱晃了晃。他听见风从墙缝里钻进来的声音，像是什么人在远处叹气。\n\n他数着自己的脚步。七级台阶。墙面是青灰色的砖，砖缝里生着苔藓。但右手边的墙壁上，有一块砖的颜色比周围的都要浅。他伸出手，指腹贴上去，凉的。\n```"
          : "";
        const reply = `（回声）${text}${demoNovel}`;
        for (const ch of reply) {
          emit({ type: "assistant.delta", persist: false, kind: "text", text: ch, conversationId, ts: now() });
          await sleep(24);
        }
        messages.push({ role: "assistant", content: reply });
        emit({ type: "assistant.message", persist: true, seq: turn.seq, text: reply, conversationId, ts: now() });
        emit({ type: "turn-end", persist: true, seq: turn.seq, turnSeq: turn.seq, conversationId, ts: now() });
        // 同 seq 重写：assistant 完整快照（与真实 loop 的 journalListener 语义一致）
        void journal?.appendTurn(turn);
      })();
      return turn;
    },
    steer: () => {},
    stop: () => {},
    cancel: () => {},
    onOutputEvent: (l: (e: OutputEvent) => void) => {
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
  });
  return server;
}

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
  app.on("will-quit", () => {
    void novelPublisher.close();
  });
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
  app.on("will-quit", () => {
    void novelWs.close();
  });

  // manager WS（conversation ↔ CMS 单连接双工；manager 与服务端互依 → holder）
  const managerHolder: { manager?: ConversationManagerServer } = {};
  const managerWs = await startConversationManagerWsServer({
    manager: () => managerHolder.manager!,
    token: randomUUID(),
  });
  app.on("will-quit", () => {
    void managerWs.close();
  });

  // 当前工作区根路径（spawn 时经 env 注入子进程，agent 文件工具落点）
  let currentWorkspaceRoot: string | undefined;
  const manager = createManager(conversationsRoot, () => currentWorkspaceRoot, {
    managerWs: {
      url: managerWs.url,
      token: managerWs.token,
      onConnected: (listener) => {
        // 临时诊断：连接报到 + main 转发调用点日志
        return managerWs.onConversationConnected((connected) => {
          debugLog("[main] conversation connected:", connected.conversationId);
          const raw = connected.handle;
          connected.handle = new Proxy(raw, {
            get(target, prop, receiver) {
              const value = Reflect.get(target, prop, receiver);
              if (typeof value !== "function") return value;
              return (...args: unknown[]) => {
                const head =
                  typeof args[0] === "function"
                    ? `<fn>`
                    : String(args[0] === undefined ? "" : JSON.stringify(args[0])).slice(0, 120);
                debugLog("[main] handle call:", String(prop), head);
                // 注意：不可用 value.apply(...)——.apply 属性访问会被 RPC path 代理捕获成路径段
                return Reflect.apply(value, target, args);
              };
            },
          });
          listener(connected);
        });
      },
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

  // kkrpc/electron 传输端点（main 侧：webContents.send / ipcMain.on）
  const endpoint = {
    send: (channel: string, msg: RPCMessage) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, msg);
    },
    on: (channel: string, listener: (_event: unknown, msg: RPCMessage) => void) => {
      ipcMain.on(channel, (event, msg) => listener(event, msg));
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
    for await (const message of novelSubscriber) {
      const entity = (message.payload as { entity?: unknown } | null)?.entity;
      if (typeof entity !== "string") continue;
      void uiApi.onNovelChanged({ entity }).catch(() => {
        // renderer 未就绪时忽略（store 下次 loadWorkspace 兜底）
      });
    }
  })();

  // workspace：目录选择器 + 定位器 + 最近列表（内存）
  const locator = new NodeWorkspaceStoreLocator({
    storageRoot: join(app.getPath("userData"), "novel-storage"),
  });
  const recentWorkspaces: { id: string; label: string }[] = [];
  const workspaceApi = {
    pickWorkspace: async (): Promise<{ referenceId: string; label: string } | undefined> => {
      const result = await dialog.showOpenDialog({
        title: "打开小说项目",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return undefined;
      const root = result.filePaths[0]!;
      return { referenceId: root, label: basename(root) };
    },
    listRecent: async () => Object.freeze([...recentWorkspaces]),
    open: async (reference: { referenceId: string; label: string }) => {
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

  const win = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: { preload: preloadPath },
  });
  win.webContents.on("console-message", (_e, level, message) => {
    console.error(`[renderer:${level}] ${message}`);
  });
  await win.loadFile(rendererHtml);
  infoLog("[main] minimal electron ready");
}

main().catch((e) => {
  console.error("[main] failed", e);
  app.quit();
});
