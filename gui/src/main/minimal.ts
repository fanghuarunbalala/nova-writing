/**
 * 最小 Electron 入口（T12 验证）：内存 manager + novel 存储 + 门面，经 kkrpc/electron 暴露给 renderer。
 * 绕开旧 DesktopApplication 的 config/workspace/node 栈，验证「Electron + 新 core 客户端栈 + 对话/novel」核心链路。
 * 会话用回显 loop（无需 provider key）；生产换 createProcessSpawner + buildNovelAgent 子进程。
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { expose, type RPCMessage } from "kkrpc";
import { join } from "node:path";
import {
  Conversation,
  ConversationManagerServer,
  InMemoryNovelStore,
  createNovelApiServer,
  electronIpcTransport,
  type AgentLoop,
  type OutputEvent,
} from "@novel/core";

// __dirname = gui/dist/minimal；上三级到项目根，再进 core/scripts（生产子进程用，当前内存模式未用）
const preloadPath = join(__dirname, "preload.cjs");
const rendererHtml = join(__dirname, "minimal.html");
const IPC_CHANNEL = "novel-rpc";

/** 回显 AgentLoop：followup 产 user.message → assistant.delta×N → turn-end（验证流式链路，无需真实 provider） */
function createEchoLoop(conversationId: string): AgentLoop {
  let seq = 0;
  const listeners = new Set<(e: OutputEvent) => void>();
  const emit = (e: OutputEvent): void => {
    for (const l of listeners) l(e);
  };
  return {
    run: async () => ({ final: { role: "assistant" as const, content: "" }, usage: undefined }),
    followup: (text: string) => {
      const now = () => new Date().toISOString();
      emit({ type: "user.message", persist: true, seq: ++seq, text, conversationId, ts: now() });
      const reply = `（回声）${text}`;
      for (const ch of reply) {
        emit({ type: "assistant.delta", persist: false, text: ch, conversationId, ts: now() });
      }
      emit({ type: "turn-end", persist: true, seq: ++seq, turnSeq: 1, conversationId, ts: now() });
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

/** 内存 manager（factory 产回显 conversation） */
function createManager(): ConversationManagerServer {
  return new ConversationManagerServer({
    create: (o) =>
      new Conversation({
        conversationId: o.conversationId,
        loop: createEchoLoop(o.conversationId),
        sampling: { model: "echo" },
      }),
  });
}

async function main(): Promise<void> {
  await app.whenReady();

  const store = new InMemoryNovelStore();
  const manager = createManager();
  const serverApi = createNovelApiServer({ manager, novel: store });

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
