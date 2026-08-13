/**
 * renderer/platform barrel（spec 5.4）。
 *
 * 4 个 ElectronXxxPort 工厂 + DesktopPlatformApi 聚合工厂。所有工厂接受
 * ElectronPreloadBridge，返回对应 port 或 undefined（bridge 子 API 缺失时）。
 */
export * from "./DesktopPlatformApi.js";
export * from "./ElectronNativeFilePort.js";
export * from "./ElectronDesignFilePort.js";
export * from "./ElectronSystemTrayPort.js";
export * from "./ElectronUpdaterPort.js";
export * from "./ElectronWindowPort.js";
