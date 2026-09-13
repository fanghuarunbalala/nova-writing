/**
 * 构建期注入的固定 server 地址（docs/PRD/客户端固定server-构建期注入.md）：
 * 宿主 shell 提供（gui renderer 读 preload 桥 __NOVEL_DEFAULT_SERVER_URL__）；
 * 未提供（web shell / 组件单测）时消费方回退各自本地常量。
 * 登录目标优先级：已保存配置地址（config.json server.url）> 本注入 > fallback。
 */
import { createContext, useContext } from "react";

export const DefaultServerUrlContext = createContext<string | undefined>(undefined);

/** 取固定 server 地址；未注入（或注入空串）时返回 fallback */
export function useDefaultServerUrl(fallback: string): string {
  const injected = useContext(DefaultServerUrlContext);
  return injected !== undefined && injected !== "" ? injected : fallback;
}
