/**
 * config 域契约：模型连接（provider/model/baseUrl/credential）+ 运行参数（Agent 采样 /
 * 模型档位 / 压缩阈值）+ 凭据状态 + 诊断。
 * provider 复用 runtime 的 ProviderType（"anthropic" | "openai"），deepseek 等走 openai + 自定义 baseUrl。
 */

import type { ProviderType, ThinkingLevel } from "../runtime/provider/types.js";
import type { ThinkingMode } from "../runtime/provider/model-info.js";
import type { SkillsListResult } from "../runtime/skill/listSkills.js";

/** 凭据引用（配置只存引用，密钥经 CredentialCipher 加密落盘） */
export type CredentialRef = string

/** 凭据状态 */
export type CredentialStatus = "present" | "missing"

/** 模型能力手动覆盖（缺省项按模型名自动识别，见 ModelInfoRegistry） */
export interface ModelCapabilities {
	/** 最大输出 token */
	maxOutputTokens?: number
	/** 上下文窗口 token（压缩触发线基准） */
	contextWindowTokens?: number
	/** 思考模式 */
	thinkingMode?: ThinkingMode
	/** 是否支持采样温度 */
	supportsTemperature?: boolean
}

/** 模型连接 profile */
export interface ModelProfile {
	/** profile id */
	id: string
	/** provider 种类 */
	provider: ProviderType
	/** 模型名（如 deepseek-v4-flash / gpt-5） */
	model: string
	/** baseUrl（缺省用 provider 默认） */
	baseUrl?: string
	/** 凭据引用（指向 CredentialRef） */
	credentialRef: CredentialRef
	/** 显示标签 */
	label?: string
	/** 模型能力覆盖（缺省按模型名自动识别） */
	capabilities?: ModelCapabilities
}

/** 模型 profile 输入（upsert 时不含 id，id 由调用方给定） */
export type ModelProfileInput = Omit<ModelProfile, "id">

/** 全局默认采样（Agent 未覆盖的项生效；模型 = 默认 profile） */
export interface SamplingDefaults {
	/** 采样温度 0–2（缺省厂商默认；模型不支持时被忽略） */
	temperature?: number
	/** 思考强度（缺省 high） */
	thinking?: ThinkingLevel
	/** 最大输出 token（缺省 8192） */
	maxTokens?: number
}

/** Agent 运行覆盖（未设置的项继承全局默认；agentType 见 RUNTIME_AGENT_TYPES） */
export interface AgentRuntimeOverride {
	/** 模型 profile id；"fast" = Fast 档位（见 RuntimeSettings.fastProfileId）；缺省继承默认 profile */
	profileId?: string
	temperature?: number
	thinking?: ThinkingLevel
	maxTokens?: number
}

/** 上下文压缩阈值（仅主 agent 装配压缩；缺省项用策略默认值） */
export interface CompactionSettings {
	/** T1 骨架化触发比例（缺省 0.7） */
	t1Ratio?: number
	/** T2 摘要线 上限比例（缺省 0.92） */
	t2CapRatio?: number
	/** 摘要输出上限 token（缺省 2048） */
	summaryMaxTokens?: number
}

/** Agent 运行参数（档位 + 全局默认采样 + 按 Agent 覆盖 + 压缩阈值） */
export interface RuntimeSettings {
	/** Fast 档位绑定的 profile id（Agent 覆盖可用 "fast" 引用；缺省 = 默认 profile） */
	fastProfileId?: string
	/** 全局默认采样 */
	samplingDefaults: SamplingDefaults
	/** 按 agentType 覆盖（novel / Explore / Compose） */
	agents: Readonly<Record<string, AgentRuntimeOverride>>
	/** 上下文压缩阈值 */
	compaction: CompactionSettings
}

/** config 快照 */
export interface ConfigSnapshot {
	/** 模型 profile 列表 */
	profiles: readonly ModelProfile[]
	/** 默认 profile id（缺省取第一个） */
	defaultProfileId?: string
	/** 各凭据引用是否存在密钥 */
	credentials: Readonly<Record<CredentialRef, CredentialStatus>>
	/** Agent 运行参数（缺省全策略默认值） */
	runtime?: RuntimeSettings
	/** 禁用技能名单（Agent Skills；缺省全启用） */
	skillsDisabled?: readonly string[]
	/** 诊断 */
	diagnostics: { logLevel: string }
}

/** config 变更 */
export type ConfigMutation =
	| { op: "model.upsert"; profileId: string; profile: ModelProfileInput }
	| { op: "model.remove"; profileId: string }
	| { op: "model.setDefault"; profileId: string }
	| { op: "runtime.set"; runtime: RuntimeSettings }
	| { op: "skills.setDisabled"; names: readonly string[] }
	| { op: "credential.save"; ref: CredentialRef; secret: string }
	| { op: "credential.delete"; ref: CredentialRef }

/** 连接测试输入：apiKey 直传（引导向导场景）或 credentialRef 引用已存凭据（设置页场景；apiKey 优先） */
export interface ConnectionTestInput {
	/** provider 种类 */
	provider: ProviderType
	/** baseUrl（缺省用 provider 默认） */
	baseUrl?: string
	/** 明文密钥（待验证；只在 server 进程内使用，不落盘不回传） */
	apiKey?: string
	/** 已存凭据引用（server 侧经 store.resolveSecret 解密） */
	credentialRef?: CredentialRef
}

/** 连接测试结果（失败附中文原因，不含密钥等敏感内容） */
export type ConnectionTestResult =
	| { ok: true }
	| { ok: false; error: string }

/** provider 运行形态（启动时快照，会话期间不变；宿主未接线时客户端回退 providerLive=true） */
export interface ProviderRuntimeStatus {
	/** 启动时默认 profile 凭据已解析（对话 spawner 已创建）；false = 回显模式，provider 修改需重启生效 */
	providerLive: boolean
}

/** config 对外 API（client wrap / server expose 共用） */
export interface ConfigApi {
	/**
	 * 读取配置快照
	 * @returns 配置快照
	 */
	get(): Promise<ConfigSnapshot>
	/**
	 * 变更配置（profile 增删改 / 凭据存取）
	 * @param m 变更
	 */
	mutate(m: ConfigMutation): Promise<void>
	/**
	 * 测试模型服务连通性（轻量 GET /models：验证 baseUrl 可达 + 密钥有效）
	 * @param input 测试输入（apiKey 直传或 credentialRef 引用已存凭据）
	 * @returns 测试结果（失败附中文原因）
	 */
	test(input: ConnectionTestInput): Promise<ConnectionTestResult>
	/**
	 * 读取 provider 运行形态（可选：宿主注入启动时快照；未注入时方法不存在，客户端自行回退）
	 * @returns provider 运行形态
	 */
	getRuntimeStatus?(): Promise<ProviderRuntimeStatus>
	/**
	 * 扫描技能目录并返回清单（可选：宿主注入扫描实现；未注入时方法不存在，设置页显示未装配）
	 * @returns 技能清单（含生效/禁用状态与目录路径）
	 */
	skillsList?(): Promise<SkillsListResult>
}
