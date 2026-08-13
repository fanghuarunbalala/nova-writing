/**
 * config 域契约：模型连接（provider/model/baseUrl/credential）+ 凭据状态 + 诊断。
 * provider 复用 runtime 的 ProviderType（"anthropic" | "openai"），deepseek 等走 openai + 自定义 baseUrl。
 */

import type { ProviderType } from "../runtime/provider/types.js";

/** 凭据引用（配置只存引用，密钥经 CredentialCipher 加密落盘） */
export type CredentialRef = string

/** 凭据状态 */
export type CredentialStatus = "present" | "missing"

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
}

/** 模型 profile 输入（upsert 时不含 id，id 由调用方给定） */
export type ModelProfileInput = Omit<ModelProfile, "id">

/** config 快照 */
export interface ConfigSnapshot {
	/** 模型 profile 列表 */
	profiles: readonly ModelProfile[]
	/** 默认 profile id（缺省取第一个） */
	defaultProfileId?: string
	/** 各凭据引用是否存在密钥 */
	credentials: Readonly<Record<CredentialRef, CredentialStatus>>
	/** 诊断 */
	diagnostics: { logLevel: string }
}

/** config 变更 */
export type ConfigMutation =
	| { op: "model.upsert"; profileId: string; profile: ModelProfileInput }
	| { op: "model.remove"; profileId: string }
	| { op: "model.setDefault"; profileId: string }
	| { op: "credential.save"; ref: CredentialRef; secret: string }
	| { op: "credential.delete"; ref: CredentialRef }

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
}
