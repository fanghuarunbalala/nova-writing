/**
 * createDesktopPlatformApi
 *
 * 一次性构造 DesktopPlatformApi 聚合（spec 5.4）：从 ElectronPreloadBridge 解析
 * 4 个子 bridge，分别构造对应的 renderer port，组合成 Object.freeze 的聚合对象。
 *
 * 调用方：DesktopRendererBootstrap 在装配 extensions/features 时使用此工厂，
 * 把桌面专属能力注入 createDesktopUiExtensions（title bar window 控件）和
 * createElectronFrontendPlatform（files port 委托到原生文件选择）。
 *
 * 行为约定：
 * - 任意子 bridge 缺失时对应 port 为 undefined（不影响其它 port 构造）
 * - 返回值始终是 Object.freeze 的对象；消费者应使用 nullish 检查消费每个 port
 * - 不抛错：bridge 缺失不是错误，仅是能力降级
 */
import type {
  DesktopPlatformApi,
  ElectronPreloadBridge,
} from "../../shared/index.js";
import { createElectronNativeFilePort } from "./ElectronNativeFilePort.js";
import { createElectronDesignFilePort } from "./ElectronDesignFilePort.js";
import { createElectronSystemTrayPort } from "./ElectronSystemTrayPort.js";
import { createElectronUpdaterPort } from "./ElectronUpdaterPort.js";
import { createElectronWindowPort } from "./ElectronWindowPort.js";

export function createDesktopPlatformApi(
  bridge: ElectronPreloadBridge,
): DesktopPlatformApi {
  return Object.freeze({
    ...(bridge.window === undefined ? {} : { window: createElectronWindowPort(bridge) }),
    ...(bridge.updater === undefined
      ? {}
      : { updater: createElectronUpdaterPort(bridge) }),
    ...(bridge.tray === undefined ? {} : { tray: createElectronSystemTrayPort(bridge) }),
    ...(bridge.files === undefined ? {} : { files: createElectronNativeFilePort(bridge) }),
    ...(bridge.design === undefined ? {} : { design: createElectronDesignFilePort(bridge) }),
  });
}
