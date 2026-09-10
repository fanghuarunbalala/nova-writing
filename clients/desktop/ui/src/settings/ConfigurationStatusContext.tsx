/**
 * ConfigurationStatusContext
 *
 * 模型服务配置状态的小型独立 context：默认 profile 凭据是否就绪
 * （未就绪 = 对话运行在回声模式，不调用大模型）。独立于 NovelAppContext
 * 聚合对象发布，只有横幅类深层组件（ChatEmptyState 等）订阅，
 * 避免 NovelAppContext 任意字段变化引发的全树重渲染（对齐分层原则）。
 */
import { createContext, useContext } from "react";
import type { ConfigSnapshot } from "@novel/core";

export interface ConfigurationStatusContextValue {
  /** 默认模型 profile 凭据是否就绪（无 configurationClient 的宿主恒 true，不打扰） */
  readonly modelConfigured: boolean;
  /** 重开新手引导向导 */
  readonly openGuide: () => void;
  /** 打开设置（缺省落在「模型」分类） */
  readonly openSettings: () => void;
}

export const ConfigurationStatusContext = createContext<ConfigurationStatusContextValue | null>(
  null,
);

/** 无 Provider 时的回退（共享组件独立渲染 / 测试场景：不显示横幅，动作为空操作） */
const FALLBACK_STATUS: ConfigurationStatusContextValue = Object.freeze({
  modelConfigured: true,
  openGuide: () => {},
  openSettings: () => {},
});

export function useConfigurationStatus(): ConfigurationStatusContextValue {
  return useContext(ConfigurationStatusContext) ?? FALLBACK_STATUS;
}

/**
 * 快照 → 默认模型服务是否可用：缺省 profile = defaultProfileId 或第一个，
 * 凭据状态需为 present（与 main 进程回声模式判定一致）。
 */
export function isModelConfigured(snapshot: ConfigSnapshot): boolean {
  const profile =
    snapshot.profiles.find((item) => item.id === snapshot.defaultProfileId) ??
    snapshot.profiles[0];
  return profile !== undefined && snapshot.credentials[profile.credentialRef] === "present";
}
