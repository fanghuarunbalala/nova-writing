/**
 * 桌面专属服务 barrel（spec 5.4）。
 *
 * 4 个 domain：
 * - window: 主窗口操作 port + IPC controller
 * - updater: 自动更新 port + IPC controller
 * - tray: 系统托盘 port + IPC controller
 * - nativefile: 原生文件选择 port + IPC controller
 *
 * 详见各子目录 README 注释。
 */
export * from "./window/index.js";
export * from "./updater/index.js";
export * from "./tray/index.js";
export * from "./nativefile/index.js";
