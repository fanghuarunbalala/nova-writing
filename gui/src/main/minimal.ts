/**
 * 最小 Electron 入口：node 宿主装配（sqlite novel + 子进程 conversation + 门面），经 kkrpc/electron 暴露给 renderer。
 * - novel：SqliteNovelStore 落盘（userData/novel.db）
 * - conversation：spawnConversation 走子进程（desktop-child.mjs，真实 provider）；createOrResume 回退内存回显 loop
 */
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { expose, proxy, type RPCMessage } from "kkrpc/remote-refs";
import { basename, join } from "node:path";
import {
  Conversation,
  ConversationManagerServer,
  FileConversationJournalService,
  SqliteNovelStore,
  ConfigServer,
  createNovelApiServer,
  createProcessSpawner,
  electronIpcTransport,
  type AgentLoop,
  type ConversationJournalService,
  type CredentialCipher,
  type LLMessage,
  type NovelStore,
  type OutputEvent,
  type TurnContext,
} from "@novel/core";
import { NodeApplicationConfigStore, NodeConfigHomeResolver, NodeWorkspaceStoreLocator } from "@novel/core/node";

// __dirname = gui/dist/minimal；上三级到项目根，再进 core/scripts
const preloadPath = join(__dirname, "preload.cjs");
const rendererHtml = join(__dirname, "minimal.html");
const childScript = join(__dirname, "..", "..", "..", "core", "scripts", "desktop-child.mjs");
const IPC_CHANNEL = "novel-rpc";
const CONFIG_CHANNEL = "config-rpc";
const WORKSPACE_CHANNEL = "workspace-rpc";

/**
 * 回显 AgentLoop：followup 即时开 turn 产 turn-start/user.message → assistant.delta×N →
 * assistant.message/turn-end → journal 快照落盘（验证流式链路 + journal 语义，无需真实 provider）
 */
function createEchoLoop(
  conversationId: string,
  journal?: ConversationJournalService,
): AgentLoop {
  let seq = 0;
  const listeners = new Set<(e: OutputEvent) => void>();
  const emit = (e: OutputEvent): void => {
    for (const l of listeners) l(e);
  };
  const now = () => new Date().toISOString();
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
      const reply = `（回声）${text}`;
      for (const ch of reply) {
        emit({ type: "assistant.delta", persist: false, kind: "text", text: ch, conversationId, ts: now() });
      }
      messages.push({ role: "assistant", content: reply });
      emit({ type: "assistant.message", persist: true, seq: turn.seq, text: reply, conversationId, ts: now() });
      emit({ type: "turn-end", persist: true, seq: turn.seq, turnSeq: turn.seq, conversationId, ts: now() });
      // 同 seq 重写：assistant 完整快照（与真实 loop 的 journalListener 语义一致）
      void journal?.appendTurn(turn);
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

/** manager：有 provider key 时 spawnConversation 走子进程（真实 provider，经 fd 3 共享 novel store）；否则回退内存回显 loop */
function createManager(store: NovelStore, conversationsRoot: string): ConversationManagerServer {
  const factory = {
    create: (o: { conversationId: string }) => {
      // 回显模式同样落盘：与子进程 journal 语义一致（history/回执互认）
      const journal = new FileConversationJournalService({
        conversationId: o.conversationId,
        filePath: join(conversationsRoot, o.conversationId, "journal.jsonl"),
      });
      void journal.open();
      return new Conversation({
        conversationId: o.conversationId,
        loop: createEchoLoop(o.conversationId, journal),
        sampling: { model: "echo" },
        journal,
      });
    },
  };
  const spawner =
    process.env.NOVEL_PROVIDER_API_KEY !== undefined
      ? createProcessSpawner(childScript, store)
      : undefined;
  return new ConversationManagerServer(factory, spawner, { storedirRoot: conversationsRoot });
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
  const conversationsRoot = join(app.getPath("userData"), "novel-storage", "conversations");
  const manager = createManager(store, conversationsRoot);
  const serverApi = createNovelApiServer({ manager, novel: store, proxy, journalDir: conversationsRoot });

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
      return session;
    },
    close: async () => {},
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
  console.error("[main] minimal electron ready");
}

main().catch((e) => {
  console.error("[main] failed", e);
  app.quit();
});
