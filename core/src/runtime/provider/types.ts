/** Provider 类型，决定使用哪个适配器实现 */
export type ProviderType = "anthropic" | "openai";

/** Provider 实例配置（createProvider 时传入，实例内部持有；不锁模型，模型由每次请求的 SamplingConfig 决定） */
export interface ProviderConfig {
  /** Provider 唯一标识，如 "default" */
  id: string;
  /** Provider 类型，选择对应适配器 */
  type: ProviderType;
  /** API 端点地址；缺省用该类型默认端点 */
  baseUrl?: string;
  /** API 密钥；缺省从环境变量读取 */
  apiKey?: string;
  /** 单次请求超时（毫秒），缺省用全局默认 */
  timeoutMs?: number;
}

/** effort 档位（映射目标） */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/** 思考档位：off 关闭，low~max 逐级加深（适配层映射到各家 effort/budget） */
export type ThinkingLevel = "off" | EffortLevel;

/** 单次请求的采样参数（每次调用可变） */
export interface SamplingConfig {
  /** 模型名（必填，ProviderConfig 不携带模型） */
  model: string;
  /** 采样温度 0–2（适配器按各家能力映射；如 Anthropic 新模型已移除温度，则忽略） */
  temperature?: number;
  /** 最大生成 token 数 */
  maxTokens?: number;
  /** 思考档位：缺省跟随模型默认；off 关闭；low~max 逐级加深 */
  thinking?: ThinkingLevel;
}

/** 工具调用（assistant 消息携带） */
export interface ToolCall {
  /** 工具调用 id，ToolResultMessage.id 通过它回填 */
  id: string;
  /** 工具名 */
  name: string;
  /** 工具参数（JSON 字符串，无损保留原始格式） */
  args: string;
}

/** 系统提醒消息（动态注入的约束/规则/状态，区别于静态 system prompt） */
export interface SystemMessage {
  role: "system";
  content: string;
}

/** 用户消息 */
export interface UserMessage {
  role: "user";
  content: string;
}

/** 助手消息，可携带工具调用 */
export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

/** 工具结果消息 */
export interface ToolResultMessage {
  role: "tool";
  content: string;
  /** 对应 AssistantMessage.toolCalls[].id */
  id: string;
}

/** 对话消息：按 role 分类的判别联合 */
export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;

/** provider 中立的工具 schema（适配器内部转译成各 SDK 原生 tool 结构） */
export interface ToolScheme {
  /** 工具名 */
  name: string;
  /** 工具描述，帮助模型决定何时调用 */
  description?: string;
  /** 参数 JSON Schema（object 形态） */
  parameters?: Record<string, unknown>;
}

/** 单次请求参数（config 由 provider 实例持有，不在请求内重复） */
export interface ProviderCall {
  /** 系统提示词（静态，请求头部一次性注入） */
  system: string;
  /** 工具 schema 清单（provider 中立描述，适配器内部转译） */
  tools?: ToolScheme[];
  /** 对话消息序列（含 SystemMessage 作为动态 system reminder） */
  messages: Message[];
  /** 本次请求的采样配置 */
  sampling: SamplingConfig;
  /** 取消信号，供 parent 进程打断 */
  signal?: AbortSignal;
}

/** 一次请求的完整结果（仅成功态；一切失败走 ProviderError 异常通道） */
export interface ProviderResult {
  /** 结束原因：stop 正常 / tool_call 模型请求调工具 / length 达到 maxTokens 上限截断 */
  finishReason: "stop" | "tool_call" | "length";
  /** 模型返回的 assistant 消息（stop/length 为文本，tool_call 携带 toolCalls） */
  message: AssistantMessage;
  /** 本次请求的 token 用量 */
  usage?: { inputTokens: number; outputTokens: number };
}

/** 流式中间增量（过程产物，通过回调接收） */
export type ProviderDelta =
  /** 正式回复文本增量 */
  | { type: "text-delta"; text: string }
  /** 推理/思考过程增量（如 extended thinking、o1 reasoning_content；无则不产出） */
  | { type: "reasoning-delta"; text: string };

/** 单次请求的中间增量回调 */
export type ProviderOnDelta = (delta: ProviderDelta) => void;
