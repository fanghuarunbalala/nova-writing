/**
 * 最小 Electron 入口（T12 验证）：spawn conversation 进程 + Electron IPC 桥接。
 * 绕开旧 DesktopApplication 的复杂 controller，验证「Electron 启动 + spawn conversation + 对话」核心链路。
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { wrap, expose } from "kkrpc";
import { createStdioTransport, electronIpcTransport } from "@novel/core";

// cjs 环境 __dirname 原生可用（esbuild cjs bundle 提供）
// __dirname = gui/dist/minimal；上三级到项目根，再进 core/scripts
const childScript = join(__dirname, "..", "..", "..", "core", "scripts", "conversation-stdio-child.mjs");
const preloadPath = join(__dirname, "preload.cjs");
const rendererHtml = join(__dirname, "minimal.html");
const IPC_CHANNEL = "novel-rpc";

/** spawn conversation 进程，返回 stdio 包出的 ConversationHandle */
function spawnConversation() {
  const child = spawn(process.execPath, [childScript], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, CONVERSATION_ID: "main", AGENT_ID: "main" },
  });
  const transport = createStdioTransport({ readable: child.stdout, writable: child.stdin });
  return { child, handle: wrap(transport) };
}

/** 把 conversation handle 经 Electron IPC 暴露给 renderer（unary 方法：sendUserMessage/sendSystemControl） */
function bridgeToRenderer(handle: unknown) {
  const endpoint = {
    send: (channel: string, msg: unknown) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, msg);
      }
    },
    on: (channel: string, listener: (_event: unknown, msg: unknown) => void) => {
      ipcMain.on(channel, (event, msg) => listener(event, msg));
    },
    off: (channel: string, listener: (_event: unknown, msg: unknown) => void) => {
      ipcMain.off(channel, listener);
    },
  };
  const transport = electronIpcTransport({ endpoint, channel: IPC_CHANNEL });
  expose(handle, transport);
}

/** 订阅 conversation 事件流（stdio streaming），主动推送到 renderer（绕开双重 streaming） */
function pipeEvents(handle: { events(): AsyncIterable<unknown> }) {
  void (async () => {
    for await (const evt of handle.events()) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("conversation-event", evt);
      }
    }
  })();
}

async function main() {
  await app.whenReady();
  const { handle } = spawnConversation();
  bridgeToRenderer(handle);
  pipeEvents(handle as { events(): AsyncIterable<unknown> });

  const win = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: {
      preload: preloadPath,
    },
  });
  // 转发 renderer console 到主进程 stdout（诊断 renderer 报错）
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
