/**
 * 构建期注入的固定 server 地址（docs/PRD/客户端固定server-构建期注入.md）：
 * 宿主 shell 提供（gui renderer 读 preload 桥 __NOVEL_DEFAULT_SERVER_URL__）；
 * 未提供（web shell / 组件单测）时消费方回退各自本地常量。
 *
 * 登录目标优先级（v0.1 修正：地址输入已退役，僵尸 saved url 无界面可修——注入必须压过）：
 * 构建期注入 > 已保存配置地址（config.json server.url）> fallback。
 * 换目标 = 重新构建；本地开发用 NOVA_DEFAULT_SERVER_URL 覆盖构建。
 */
import { createContext, useContext } from "react";

export const DefaultServerUrlContext = createContext<string | undefined>(undefined);

/** 原始注入值：未注入（或注入空串）时 undefined——优先级判定用 */
export function useInjectedServerUrl(): string | undefined {
  const injected = useContext(DefaultServerUrlContext);
  return injected !== undefined && injected !== "" ? injected : undefined;
}

/** 取固定 server 地址；未注入（或注入空串）时返回 fallback（展示/兜底用） */
export function useDefaultServerUrl(fallback: string): string {
  return useInjectedServerUrl() ?? fallback;
}
