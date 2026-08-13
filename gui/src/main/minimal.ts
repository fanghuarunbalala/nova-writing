/**
 * 最小 Electron 入口（T12 验证）：spawn conversation 进程 + Electron IPC 桥接。
 * 绕开旧 DesktopApplication 的复杂 controller，验证「Electron 启动 + spawn conversation + 对话」核心链路。
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wrap, expose } from "kkrpc";
import { createStdioTransport, electronIpcTransport } from "@novel/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const childScript = join(__dirname, "..", "..", "..", "core", "scripts", "conversation-stdio-child.mjs");
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

/** 把 conversation handle 经 Electron IPC 暴露给 renderer */
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

async function main() {
  await app.whenReady();
  const { handle } = spawnConversation();
  bridgeToRenderer(handle);

  const win = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "minimal-preload.js"),
    },
  });
  await win.loadFile(join(__dirname, "..", "renderer", "minimal.html"));
  console.error("[main] minimal electron ready");
}

main().catch((e) => {
  console.error("[main] failed", e);
  app.quit();
});
