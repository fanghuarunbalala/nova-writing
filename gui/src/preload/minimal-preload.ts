/**
 * 最小 preload（T12 验证）：contextBridge 暴露 secure IPC 桥（channel 白名单）。
 */
import { contextBridge, ipcRenderer } from "electron";
import { createSecureIpcBridge } from "@novel/core";

const bridge = createSecureIpcBridge({
  ipcRenderer,
  allowedChannels: ["novel-rpc"],
});

contextBridge.exposeInMainWorld("novelApi", { bridge });
