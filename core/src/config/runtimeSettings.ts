/**
 * RuntimeSettings 校验与运行时解析。
 *
 * - validateRuntimeSettings：runtime.set / 存储层共用（非法值抛 Error；未知 agentType
 *   静默丢弃——向前兼容新增 Agent）
 * - resolveRuntimeAgents：宿主（Electron main）启动/配置变更时把快照解析为子进程
 *   可直连的完整 agent 连接 + 采样（凭据经 resolveSecret 解析；引用已删 profile 或
 *   凭据缺失的覆盖项回落默认 profile），序列化为 NOVEL_RUNTIME_SETTINGS env
 * - parseRuntimeSettingsEnv：子进程侧解析该 env（缺省/非法返回 undefined 回落 env 默认）
 */
import type { ProviderType, ThinkingLevel } from "../runtime/provider/types.js";
import type {
	AgentRuntimeOverride,
	CompactionSettings,
	ConfigSnapshot,
	CredentialRef,
	ModelCapabilities,
	RuntimeSettings,
} from "./contract.js";

/** 参与运行参数解析的 agentType 全集（novel=主创作 / Explore=探索 / Compose=起草） */
export const RUNTIME_AGENT_TYPES = ["novel", "Explore", "Compose"] as const;

/** Agent 覆盖中引用 Fast 档位的保留值 */
export const FAST_PROFILE_REF = "fast";

/** 思考档位合法集（env/UI/store 校验共用） */
const THINKING_LEVELS: ReadonlySet<string> = new Set([
	"off",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

/** 空 RuntimeSettings（UI 初始 draft / 存储默认） */
export function emptyRuntimeSettings(): RuntimeSettings {
	return { samplingDefaults: {}, agents: {}, compaction: {} };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** number 字段校验（缺省 undefined；提供时必须满足 predicate） */
function optionalNumber(
	container: Record<string, unknown>,
	key: string,
	predicate: (n: number) => boolean,
	rangeDesc: string,
): number | undefined {
	const raw = container[key];
	if (raw === undefined) return undefined;
	if (typeof raw !== "number" || !Number.isFinite(raw) || !predicate(raw)) {
		throw new Error(`runtime 配置非法：${key} 需${rangeDesc}`);
	}
	return raw;
}

/** 正整数字段（maxTokens / summaryMaxTokens 等） */
function positiveInt(container: Record<string, unknown>, key: string): number | undefined {
	return optionalNumber(container, key, (n) => Number.isInteger(n) && n > 0, "正整数");
}

/** 思考档位字段 */
function thinkingField(container: Record<string, unknown>, key: string): ThinkingLevel | undefined {
	const raw = container[key];
	if (raw === undefined) return undefined;
	if (typeof raw !== "string" || !THINKING_LEVELS.has(raw)) {
		throw new Error(`runtime 配置非法：${key} 需为思考档位（off/low/medium/high/xhigh/max）`);
	}
	return raw as ThinkingLevel;
}

/** 模型能力覆盖校验（model.upsert / 子进程 env 共用；全部可选） */
export function validateModelCapabilities(raw: unknown): ModelCapabilities | undefined {
	if (raw === undefined) return undefined;
	if (!isPlainObject(raw)) throw new Error("capabilities 需为对象");
	const caps: ModelCapabilities = {};
	const maxOutputTokens = positiveInt(raw, "maxOutputTokens");
	if (maxOutputTokens !== undefined) caps.maxOutputTokens = maxOutputTokens;
	const contextWindowTokens = positiveInt(raw, "contextWindowTokens");
	if (contextWindowTokens !== undefined) caps.contextWindowTokens = contextWindowTokens;
	if (raw.thinkingMode !== undefined) {
		const mode = raw.thinkingMode;
		if (
			typeof mode !== "string" ||
			!["adaptive-effort", "budget-tokens", "reasoning-effort", "none"].includes(mode)
		) {
			throw new Error("capabilities.thinkingMode 需为思考模式枚举");
		}
		caps.thinkingMode = mode as ModelCapabilities["thinkingMode"];
	}
	if (raw.supportsTemperature !== undefined) {
		if (typeof raw.supportsTemperature !== "boolean") {
			throw new Error("capabilities.supportsTemperature 需为布尔");
		}
		caps.supportsTemperature = raw.supportsTemperature;
	}
	return Object.keys(caps).length > 0 ? caps : undefined;
}

/**
 * 校验并归一 RuntimeSettings（未知字段忽略；未知 agentType 丢弃）
 * @param raw 待校验值（RPC 载荷）
 * @param profileIds 现存 profile id 集（profileId 引用校验）
 * @returns 归一后的 RuntimeSettings
 * @throws Error 非法值（越界温度 / 非法思考档位 / T1 ≥ T2 / 未知 profile 引用等）
 */
export function validateRuntimeSettings(
	raw: unknown,
	profileIds: readonly string[],
): RuntimeSettings {
	if (!isPlainObject(raw)) throw new Error("runtime 配置需为对象");
	const known = new Set(profileIds);

	const fastProfileId =
		raw.fastProfileId === undefined ? undefined : String(raw.fastProfileId);
	if (fastProfileId !== undefined && fastProfileId !== "" && !known.has(fastProfileId)) {
		throw new Error(`runtime 配置非法：fastProfileId 引用未知 profile（${fastProfileId}）`);
	}

	const defaultsRaw = isPlainObject(raw.samplingDefaults) ? raw.samplingDefaults : {};
	const samplingDefaults = {
		...(optionalNumber(defaultsRaw, "temperature", (n) => n >= 0 && n <= 2, "0–2 之间的温度") !==
		undefined
			? { temperature: defaultsRaw.temperature as number }
			: {}),
		...(thinkingField(defaultsRaw, "thinking") !== undefined
			? { thinking: defaultsRaw.thinking as ThinkingLevel }
			: {}),
		...(positiveInt(defaultsRaw, "maxTokens") !== undefined
			? { maxTokens: defaultsRaw.maxTokens as number }
			: {}),
	};

	const agents: Record<string, AgentRuntimeOverride> = {};
	if (raw.agents !== undefined) {
		if (!isPlainObject(raw.agents)) throw new Error("runtime.agents 需为对象");
		for (const [agentType, overrideRaw] of Object.entries(raw.agents)) {
			if (!(RUNTIME_AGENT_TYPES as readonly string[]).includes(agentType)) continue;
			if (!isPlainObject(overrideRaw)) {
				throw new Error(`runtime.agents.${agentType} 需为对象`);
			}
			const profileId =
				overrideRaw.profileId === undefined ? undefined : String(overrideRaw.profileId);
			if (
				profileId !== undefined &&
				profileId !== "" &&
				profileId !== FAST_PROFILE_REF &&
				!known.has(profileId)
			) {
				throw new Error(`runtime 配置非法：${agentType} 引用未知 profile（${profileId}）`);
			}
			const override: AgentRuntimeOverride = {
				...(profileId !== undefined && profileId !== "" ? { profileId } : {}),
				...(optionalNumber(overrideRaw, "temperature", (n) => n >= 0 && n <= 2, "0–2 之间的温度") !==
				undefined
					? { temperature: overrideRaw.temperature as number }
					: {}),
				...(thinkingField(overrideRaw, "thinking") !== undefined
					? { thinking: overrideRaw.thinking as ThinkingLevel }
					: {}),
				...(positiveInt(overrideRaw, "maxTokens") !== undefined
					? { maxTokens: overrideRaw.maxTokens as number }
					: {}),
			};
			if (Object.keys(override).length > 0) agents[agentType] = override;
		}
	}

	const compactRaw = isPlainObject(raw.compaction) ? raw.compaction : {};
	const t1Ratio = optionalNumber(compactRaw, "t1Ratio", (n) => n > 0 && n < 1, "0–1 之间的比例");
	const t2CapRatio = optionalNumber(compactRaw, "t2CapRatio", (n) => n > 0 && n < 1, "0–1 之间的比例");
	if (t1Ratio !== undefined && t2CapRatio !== undefined && t1Ratio >= t2CapRatio) {
		throw new Error("runtime 配置非法：t1Ratio 需小于 t2CapRatio");
	}
	const compaction: CompactionSettings = {
		...(t1Ratio !== undefined ? { t1Ratio } : {}),
		...(t2CapRatio !== undefined ? { t2CapRatio } : {}),
		...(positiveInt(compactRaw, "summaryMaxTokens") !== undefined
			? { summaryMaxTokens: compactRaw.summaryMaxTokens as number }
			: {}),
	};

	return {
		...(fastProfileId !== undefined && fastProfileId !== "" ? { fastProfileId } : {}),
		samplingDefaults,
		agents,
		compaction,
	};
}

/** profile 删除后的引用清理：fastProfileId / agents[].profileId 指向被删 profile 时摘除 */
export function removeProfileReferences(
	settings: RuntimeSettings | undefined,
	removedProfileId: string,
): RuntimeSettings | undefined {
	if (settings === undefined) return undefined;
	const agents: Record<string, AgentRuntimeOverride> = {};
	for (const [agentType, override] of Object.entries(settings.agents)) {
		if (override.profileId === removedProfileId) {
			const { profileId: _drop, ...rest } = override;
			if (Object.keys(rest).length > 0) agents[agentType] = rest;
		} else {
			agents[agentType] = override;
		}
	}
	return {
		...(settings.fastProfileId === removedProfileId ? {} : { fastProfileId: settings.fastProfileId }),
		samplingDefaults: settings.samplingDefaults,
		agents,
		compaction: settings.compaction,
	};
}

/** 解析后的单 agent 连接（provider + 采样全量；NOVEL_RUNTIME_SETTINGS 条目形态） */
export interface ResolvedAgentConnection {
	provider: ProviderType
	model: string
	baseUrl?: string
	apiKey?: string
	temperature?: number
	thinking?: ThinkingLevel
	maxTokens?: number
}

/** resolveRuntimeAgents 产物（env 序列化形态；子进程按 agentType 直取） */
export interface ResolvedRuntime {
	agents: Readonly<Record<string, ResolvedAgentConnection>>
	compaction: CompactionSettings
	modelInfos: readonly { model: string; capabilities: ModelCapabilities }[]
}

/**
 * 把配置快照解析为子进程可直连的 agent 连接（凭据明文经 resolveSecret；引用已删
 * profile / 凭据缺失的覆盖回落默认 profile）。无 profile 时 agents 为空（子进程回落 env 默认）。
 * @param snapshot 配置快照
 * @param resolveSecret 凭据解析（宿主侧，明文不出本函数调用链）
 * @returns 全量解析结果（含压缩阈值与能力覆盖）
 */
export async function resolveRuntimeAgents(
	snapshot: ConfigSnapshot,
	resolveSecret: (ref: CredentialRef) => Promise<string | undefined>,
): Promise<ResolvedRuntime> {
	const profiles = snapshot.profiles;
	const settings = snapshot.runtime;
	const def = profiles.find((p) => p.id === snapshot.defaultProfileId) ?? profiles[0];
	if (def === undefined) {
		return { agents: {}, compaction: settings?.compaction ?? {}, modelInfos: [] };
	}
	const defSecret = await resolveSecret(def.credentialRef);

	/** 覆盖引用 → profile + 凭据（引用无效 / 凭据缺失回落默认） */
	const resolveProfile = async (
		override: AgentRuntimeOverride | undefined,
	): Promise<{ model: string; provider: ProviderType; baseUrl?: string; apiKey?: string }> => {
		let targetId: string | undefined;
		if (override?.profileId === FAST_PROFILE_REF) {
			targetId = settings?.fastProfileId;
		} else if (override?.profileId !== undefined && override.profileId !== "") {
			targetId = override.profileId;
		}
		if (targetId !== undefined && targetId !== def.id) {
			const p = profiles.find((x) => x.id === targetId);
			if (p !== undefined) {
				const secret = await resolveSecret(p.credentialRef);
				if (secret !== undefined) {
					return {
						provider: p.provider,
						model: p.model,
						...(p.baseUrl !== undefined ? { baseUrl: p.baseUrl } : {}),
						apiKey: secret,
					};
				}
			}
		}
		return {
			provider: def.provider,
			model: def.model,
			...(def.baseUrl !== undefined ? { baseUrl: def.baseUrl } : {}),
			...(defSecret !== undefined ? { apiKey: defSecret } : {}),
		};
	};

	const agents: Record<string, ResolvedAgentConnection> = {};
	for (const agentType of RUNTIME_AGENT_TYPES) {
		const override = settings?.agents[agentType];
		const defaults = settings?.samplingDefaults;
		const profile = await resolveProfile(override);
		const temperature = override?.temperature ?? defaults?.temperature;
		agents[agentType] = {
			...profile,
			...(temperature !== undefined ? { temperature } : {}),
			thinking: override?.thinking ?? defaults?.thinking ?? "high",
			maxTokens: override?.maxTokens ?? defaults?.maxTokens ?? 8192,
		};
	}

	const modelInfos = profiles
		.filter((p) => p.capabilities !== undefined)
		.map((p) => ({ model: p.model, capabilities: p.capabilities! }));

	return { agents, compaction: settings?.compaction ?? {}, modelInfos };
}

/**
 * 子进程侧解析 NOVEL_RUNTIME_SETTINGS env 载荷（resolveRuntimeAgents 的 JSON 产物）
 * @param raw env 原文（缺省/空白/非法结构返回 undefined → 调用方回落 env 默认）
 */
export function parseRuntimeSettingsEnv(raw: string | undefined): ResolvedRuntime | undefined {
	if (raw === undefined || raw.trim() === "") return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isPlainObject(parsed)) return undefined;
	if (parsed.agents !== undefined && !isPlainObject(parsed.agents)) return undefined;
	const agents: Record<string, ResolvedAgentConnection> = {};
	if (parsed.agents !== undefined) {
		for (const [agentType, entry] of Object.entries(parsed.agents)) {
			if (!isPlainObject(entry) || typeof entry.model !== "string") continue;
			agents[agentType] = {
				model: entry.model,
				provider: entry.provider === "anthropic" ? "anthropic" : "openai",
				...(typeof entry.baseUrl === "string" ? { baseUrl: entry.baseUrl } : {}),
				...(typeof entry.apiKey === "string" ? { apiKey: entry.apiKey } : {}),
				...(typeof entry.temperature === "number" ? { temperature: entry.temperature } : {}),
				...(typeof entry.thinking === "string" && THINKING_LEVELS.has(entry.thinking)
					? { thinking: entry.thinking as ThinkingLevel }
					: {}),
				...(typeof entry.maxTokens === "number" ? { maxTokens: entry.maxTokens } : {}),
			};
		}
	}
	const modelInfos: { model: string; capabilities: ModelCapabilities }[] = [];
	if (Array.isArray(parsed.modelInfos)) {
		for (const mi of parsed.modelInfos) {
			if (!isPlainObject(mi) || typeof mi.model !== "string") continue;
			try {
				const capabilities = validateModelCapabilities(mi.capabilities);
				if (capabilities !== undefined) modelInfos.push({ model: mi.model, capabilities });
			} catch {
				// 单条能力非法跳过（不拖垮整体解析）
			}
		}
	}
	const compactionRaw = isPlainObject(parsed.compaction) ? parsed.compaction : {};
	const compaction: CompactionSettings = {
		...(typeof compactionRaw.t1Ratio === "number" ? { t1Ratio: compactionRaw.t1Ratio } : {}),
		...(typeof compactionRaw.t2CapRatio === "number"
			? { t2CapRatio: compactionRaw.t2CapRatio }
			: {}),
		...(typeof compactionRaw.summaryMaxTokens === "number"
			? { summaryMaxTokens: compactionRaw.summaryMaxTokens }
			: {}),
	};
	return { agents, compaction, modelInfos };
}
