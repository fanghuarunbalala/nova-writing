/**
 * Electron IPC 传输：基于 kkrpc/electron。
 * main 侧用 ipcMain endpoint，renderer 侧经 preload secure bridge（channel 白名单）。
 */
import {
  electronIpcTransport,
  createSecureIpcBridge,
  type ElectronMessageEndpoint,
  type SecureIpcBridge,
} from "kkrpc/electron";

export {
  electronIpcTransport,
  createSecureIpcBridge,
  type ElectronMessageEndpoint,
  type SecureIpcBridge,
};
