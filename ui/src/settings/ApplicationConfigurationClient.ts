/** Platform-neutral client for persisted Configuration and Host credentials. */
import type { ConfigMutation, ConfigSnapshot } from "@novel/core";

/** config 客户端（桥 ConfigHandle：load 读 / mutate 写） */
export interface ApplicationConfigurationClient {
  /**
   * 读取配置快照
   * @returns 配置快照
   */
  load(): Promise<ConfigSnapshot>;

  /**
   * 变更配置（model profile 增删改 / 凭据存取 / 默认 profile）
   * @param m 变更
   */
  mutate(m: ConfigMutation): Promise<void>;
}
