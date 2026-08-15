/**
 * 最小 preload（T12 验证）：contextBridge 暴露 secure IPC 桥（channel 白名单）。
 * 直接从 kkrpc/electron import（纯 JS，避免 @novel/core 拉入 pino → node:os，sandbox 不可用）。
 * 另暴露 novelDesign：设计草稿文件读写（novel.design.v1.*，固定两方法硬编码通道，
 * 不暴露通用 invoke）。
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
  // 设计草稿文件端口：read/write 信封（{ok,value}|{ok:false,error}），main 侧
  // DesktopDesignIpcController 按 sender.id 授权 + workspace 根定位
  contextBridge.exposeInMainWorld("novelDesign", {
    read: (conversationId: string) => ipcRenderer.invoke("novel.design.v1.read", conversationId),
    write: (conversationId: string, content: string) =>
      ipcRenderer.invoke("novel.design.v1.write", conversationId, content),
  });
  // renderer 侧 debugLog 开关（浏览器无 process.env）
  contextBridge.exposeInMainWorld("__NOVEL_LOG_LEVEL__", process.env.NOVEL_LOG_LEVEL ?? "info");
  // 窗口控制端口（PRD WC；main 侧 window-controls:* 按 sender.id 授权）：
  // platform 判定 + 最小化/最大化切换/关闭 + 最大化状态订阅
  contextBridge.exposeInMainWorld("novelWindow", {
    platform: process.platform === "darwin" ? "mac" : "win",
    minimize: () => {
      ipcRenderer.send("window-controls:minimize");
    },
    toggleMaximize: () => {
      ipcRenderer.send("window-controls:toggle-maximize");
    },
    close: () => {
      ipcRenderer.send("window-controls:close");
    },
    onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
      const handler = (_event: unknown, maximized: boolean): void => callback(maximized);
      ipcRenderer.on("window-controls:maximized", handler as never);
      return () => {
        ipcRenderer.off("window-controls:maximized", handler as never);
      };
    },
  });
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
