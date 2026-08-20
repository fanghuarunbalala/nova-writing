/** Platform-neutral client for persisted Configuration and Host credentials. */
import type {
  ConfigMutation,
  ConfigSnapshot,
  ConnectionTestInput,
  ConnectionTestResult,
  McpServerInput,
  McpTestResult,
  ProviderRuntimeStatus,
  SkillsListResult,
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

  /**
   * 读取 provider 运行形态（启动时快照，会话期间不变）。
   * providerLive=false 为回显模式：provider/密钥修改需重启程序生效。
   * 可选：宿主未接线时设置页维持现状文案（视为已连接）。
   * @returns provider 运行形态
   */
  runtimeStatus?(): Promise<ProviderRuntimeStatus>;

  /**
   * 扫描技能目录并返回清单（设置页「技能」面板）。
   * 可选：宿主未接线时面板显示未装配。
   * @returns 技能清单（含生效/禁用状态与目录路径）
   */
  skillsList?(): Promise<SkillsListResult>;

  /**
   * 测试 MCP 服务器连通性（initialize + tools/list；成功附工具清单预览）。
   * 可选：宿主未接线时设置页隐藏测试按钮。
   * @param input 服务器配置（draft 表单直传，无需先保存）
   * @returns 测试结果（失败附中文原因）
   */
  testMcp?(input: McpServerInput): Promise<McpTestResult>;
}
