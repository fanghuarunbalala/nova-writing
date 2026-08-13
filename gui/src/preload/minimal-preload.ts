/**
 * 最小 preload（T12 验证）：contextBridge 暴露 secure IPC 桥 + 事件订阅。
 * 直接从 kkrpc/electron import（纯 JS，避免 @novel/core 拉入 pino → node:os，sandbox 不可用）。
 */
import { contextBridge, ipcRenderer } from "electron";
import { createSecureIpcBridge } from "kkrpc/electron";

try {
  const bridge = createSecureIpcBridge({
    ipcRenderer,
    allowedChannels: ["novel-rpc"],
  });
  contextBridge.exposeInMainWorld("novelApi", {
    bridge,
    // 订阅 conversation 事件（main 侧经 webContents.send 推送）
    onEvent: (callback: (evt: unknown) => void) => {
      const listener = (_e: unknown, evt: unknown) => callback(evt);
      ipcRenderer.on("conversation-event", listener);
      return () => ipcRenderer.removeListener("conversation-event", listener);
    },
  });
  console.error("[preload] novelApi exposed");
} catch (e) {
  console.error("[preload] failed:", e instanceof Error ? e.message : String(e));
}
