/**
 * 最小 preload（T12 验证）：contextBridge 暴露 secure IPC 桥（channel 白名单）。
 * 直接从 kkrpc/electron import（纯 JS，避免 @novel/core 拉入 pino → node:os，sandbox 不可用）。
 * 另暴露 novelDesign：设计草稿文件读写（novel.design.v1.*，固定两方法硬编码通道，
 * 不暴露通用 invoke）。
 */
import { contextBridge, ipcRenderer } from "electron";
import { createSecureIpcBridge } from "kkrpc/electron";

try {
  const bridge = createSecureIpcBridge({
    ipcRenderer,
    allowedChannels: ["novel-rpc", "config-rpc", "workspace-rpc", "ui-rpc"],
  });
  contextBridge.exposeInMainWorld("novelApi", { bridge });
  // 设计草稿文件端口：read/write 信封（{ok,value}|{ok:false,error}），main 侧
  // DesktopDesignIpcController 按 sender.id 授权 + workspace 根定位
  contextBridge.exposeInMainWorld("novelDesign", {
    read: (conversationId: string) => ipcRenderer.invoke("novel.design.v1.read", conversationId),
    write: (conversationId: string, content: string) =>
      ipcRenderer.invoke("novel.design.v1.write", conversationId, content),
  });
  // renderer 侧 debugLog 开关（浏览器无 process.env）
  contextBridge.exposeInMainWorld("__NOVEL_LOG_LEVEL__", process.env.NOVEL_LOG_LEVEL ?? "info");
  console.error("[preload] novelApi exposed");
} catch (e) {
  console.error("[preload] failed:", e instanceof Error ? e.message : String(e));
}
