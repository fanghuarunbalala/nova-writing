/** Electron Preload entrypoint: expose only the frozen Novel desktop bridge. */
import { contextBridge, ipcRenderer } from "electron";
import { exposeDesktopApi } from "./exposeDesktopApi.js";

exposeDesktopApi({ contextBridge, ipcRenderer });
