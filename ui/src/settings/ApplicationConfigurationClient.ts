/** Platform-neutral client for persisted Configuration and Host credentials. */
import type {
  ConfigMutation,
  ConfigSnapshot,
  ConnectionTestInput,
  ConnectionTestResult,
} from "@novel/core";

/** config 客户端（桥 ConfigHandle：load 读 / mutate 写 / test 连接探活） */
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

  /**
   * 测试模型服务连通性（轻量 GET /models：验证 baseUrl 可达 + 密钥有效）。
   * 可选：宿主未接线时引导向导 / 设置页隐藏测试按钮。
   * @param input 测试输入（apiKey 直传或 credentialRef 引用已存凭据）
   * @returns 测试结果（失败附中文原因）
   */
  test?(input: ConnectionTestInput): Promise<ConnectionTestResult>;
}
