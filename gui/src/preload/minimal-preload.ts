/**
 * 最小 preload（T12 验证）：contextBridge 暴露 secure IPC 桥（channel 白名单）。
 * 直接从 kkrpc/electron import（纯 JS，避免 @novel/core 拉入 pino → node:os，sandbox 不可用）。
 */
import { contextBridge, ipcRenderer } from "electron";
import { createSecureIpcBridge } from "kkrpc/electron";

try {
  const bridge = createSecureIpcBridge({
    ipcRenderer,
    allowedChannels: ["novel-rpc", "config-rpc", "workspace-rpc", "ui-rpc"],
  });
  contextBridge.exposeInMainWorld("novelApi", { bridge });
  // renderer 侧 debugLog 开关（浏览器无 process.env）
  contextBridge.exposeInMainWorld("__NOVEL_LOG_LEVEL__", process.env.NOVEL_LOG_LEVEL ?? "info");
  console.error("[preload] novelApi exposed");
} catch (e) {
  console.error("[preload] failed:", e instanceof Error ? e.message : String(e));
}
