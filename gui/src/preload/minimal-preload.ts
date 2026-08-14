/**
 * 最小 preload（T12 验证）：contextBridge 暴露 secure IPC 桥（channel 白名单）。
 * 直接从 kkrpc/electron import（纯 JS，避免 @novel/core 拉入 pino → node:os，sandbox 不可用）。
 * novelEvents：会话事件火线裸推订阅（gui-performance-2 功能点八；main 侧
 * ZeroMQ SUB 转发 → webContents.send，renderer 经此监听，无 kkrpc 往返）。
 */
import { contextBridge, ipcRenderer } from "electron";
import { createSecureIpcBridge } from "kkrpc/electron";

try {
  const bridge = createSecureIpcBridge({
    ipcRenderer,
    allowedChannels: ["novel-rpc", "config-rpc", "workspace-rpc", "ui-rpc", "conversation-events"],
  });
  contextBridge.exposeInMainWorld("novelApi", { bridge });
  // renderer 侧 debugLog 开关（浏览器无 process.env）
  contextBridge.exposeInMainWorld("__NOVEL_LOG_LEVEL__", process.env.NOVEL_LOG_LEVEL ?? "info");
  contextBridge.exposeInMainWorld("novelEvents", {
    /** 订阅会话事件推送（payload = {conversationId, event}）；返回取消订阅 */
    onConversationEvent: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: unknown, payload: unknown): void => callback(payload);
      ipcRenderer.on("conversation-events", handler as never);
      return () => {
        ipcRenderer.off("conversation-events", handler as never);
      };
    },
  });
  console.error("[preload] novelApi exposed");
} catch (e) {
  console.error("[preload] failed:", e instanceof Error ? e.message : String(e));
}
