/**
 * NodeApplicationConfigStore：JSON 文件版 ConfigStore（凭据经 cipher 加密落盘）。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CredentialCipher } from "../../config/CredentialCipher.js";
import type { ConfigStore } from "../../config/store.js";
import type {
	ConfigMutation,
	ConfigSnapshot,
	CredentialRef,
	McpServerConfig,
	ModelProfile,
	RuntimeSettings,
	ServerSettings,
} from "../../config/contract.js";
import {
	removeProfileReferences,
	validateModelCapabilities,
	validateRuntimeSettings,
} from "../../config/runtimeSettings.js";
import { validateSkillsDisabled } from "../../config/skillsSettings.js";
import { validateMcpServerInput } from "../../config/mcpSettings.js";

/** node config store 构造选项 */
export interface NodeApplicationConfigStoreOptions {
	/** 配置文件路径 */
	filePath: string
	/** 凭据加密器 */
	cipher: CredentialCipher
	/** 成功变更并落盘后的回调（宿主重派 env 等；回调异常不影响变更结果） */
	onMutated?: () => void | Promise<void>
}

/** 落盘结构 */
interface PersistedConfig {
	profiles: ModelProfile[]
	defaultProfileId?: string
	runtime?: RuntimeSettings
	skillsDisabled?: string[]
	mcpServers?: McpServerConfig[]
	server?: ServerSettings
	credentials: Record<CredentialRef, string>
}

/** JSON 文件版 config 存储（load 读 / mutate 写回） */
export class NodeApplicationConfigStore implements ConfigStore {
	private readonly filePath: string;
	private readonly cipher: CredentialCipher;
	private readonly onMutated?: () => void | Promise<void>;
	private profiles: ModelProfile[] = [];
	private defaultProfileId?: string;
	private runtime?: RuntimeSettings;
	private skillsDisabled?: string[];
	private mcpServers: McpServerConfig[] = [];
	private server?: ServerSettings;
	private credentials = new Map<CredentialRef, string>();

	/**
	 * @param options 文件路径 + 加密器 + 变更回调
	 */
	constructor(options: NodeApplicationConfigStoreOptions) {
		this.filePath = options.filePath;
		this.cipher = options.cipher;
		this.onMutated = options.onMutated;
	}

	/** 从磁盘加载（文件缺失/损坏/非法 runtime 则回退对应空值） */
	async load(): Promise<void> {
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = JSON.parse(raw) as PersistedConfig;
			this.profiles = parsed.profiles ?? [];
			this.defaultProfileId = parsed.defaultProfileId;
			this.credentials = new Map(Object.entries(parsed.credentials ?? {}));
			try {
				this.runtime = validateRuntimeSettings(
					parsed.runtime,
					this.profiles.map((p) => p.id),
				);
			} catch {
				// 旧版本/异常落盘的 runtime 非法：丢弃回退默认（profiles/凭据不受影响）
				this.runtime = undefined;
			}
			try {
				this.skillsDisabled = validateSkillsDisabled(parsed.skillsDisabled ?? []);
			} catch {
				// 旧版本/异常落盘的禁用名单非法：丢弃回退全启用
				this.skillsDisabled = undefined;
			}
			// 单条非法的服务器丢弃该条，其余保留（避免一台脏数据拖垮全部 MCP 配置）
			this.mcpServers = (parsed.mcpServers ?? []).filter((s) => {
				try {
					validateMcpServerInput(s);
					return true;
				} catch {
					return false;
				}
			});
			// server 连接配置：url 非字符串即丢弃（回退本地模式）；agentMode 白名单外回退 legacy
			const serverUrl = (parsed.server as { url?: unknown; agentMode?: unknown } | undefined)?.url;
			const rawMode = (parsed.server as { agentMode?: unknown } | undefined)?.agentMode;
			const agentMode = rawMode === "bundle" ? "bundle" : "legacy";
			this.server =
				typeof serverUrl === "string" && serverUrl.length > 0
					? agentMode === "bundle"
						? { url: serverUrl, agentMode }
						: { url: serverUrl }
					: agentMode === "bundle"
						? { agentMode }
						: undefined;
		} catch {
			this.profiles = [];
			this.defaultProfileId = undefined;
			this.runtime = undefined;
			this.skillsDisabled = undefined;
			this.mcpServers = [];
			this.credentials = new Map();
		}
	}

	/** 读取配置快照 */
	async get(): Promise<ConfigSnapshot> {
		const credentials: Record<CredentialRef, "present"> = {};
		for (const ref of this.credentials.keys()) credentials[ref] = "present";
		return {
			profiles: Object.freeze([...this.profiles]),
			...(this.defaultProfileId !== undefined ? { defaultProfileId: this.defaultProfileId } : {}),
			credentials: Object.freeze(credentials),
			...(this.runtime !== undefined ? { runtime: this.runtime } : {}),
			...(this.skillsDisabled !== undefined ? { skillsDisabled: this.skillsDisabled } : {}),
			...(this.mcpServers.length > 0 ? { mcpServers: this.mcpServers } : {}),
			...(this.server !== undefined ? { server: this.server } : {}),
			diagnostics: { logLevel: "info" },
		};
	}

	/** 变更配置并落盘 */
	async mutate(m: ConfigMutation): Promise<void> {
		switch (m.op) {
			case "model.upsert": {
				const { capabilities, ...rest } = m.profile;
				const caps = validateModelCapabilities(capabilities);
				this.profiles = this.profiles.filter((p) => p.id !== m.profileId);
				this.profiles.push(
					caps !== undefined ? { id: m.profileId, ...rest, capabilities: caps } : { id: m.profileId, ...rest },
				);
				if (this.defaultProfileId === undefined) this.defaultProfileId = m.profileId;
				break;
			}
			case "model.remove":
				this.profiles = this.profiles.filter((p) => p.id !== m.profileId);
				if (this.defaultProfileId === m.profileId) {
					this.defaultProfileId = this.profiles[0]?.id;
				}
				this.runtime = removeProfileReferences(this.runtime, m.profileId);
				break;
			case "model.setDefault":
				if (this.profiles.some((p) => p.id === m.profileId)) this.defaultProfileId = m.profileId;
				break;
			case "runtime.set":
				this.runtime = validateRuntimeSettings(m.runtime, this.profiles.map((p) => p.id));
				break;
			case "skills.setDisabled":
				this.skillsDisabled = validateSkillsDisabled([...m.names]);
				break;
			case "mcp.upsert": {
				validateMcpServerInput(m.server);
				const next: McpServerConfig = { id: m.serverId, ...m.server };
				this.mcpServers = [...this.mcpServers.filter((s) => s.id !== m.serverId), next];
				break;
			}
			case "mcp.remove":
				this.mcpServers = this.mcpServers.filter((s) => s.id !== m.serverId);
				break;
			case "server.set": {
				const url = m.server.url?.trim();
				const mode = m.server.agentMode === "bundle" ? ("bundle" as const) : undefined;
				this.server = url ? (mode !== undefined ? { url, agentMode: mode } : { url }) : (mode !== undefined ? { agentMode: mode } : undefined);
				break;
			}
			case "credential.save":
				this.credentials.set(m.ref, await this.cipher.encrypt(m.secret));
				break;
			case "credential.delete":
				this.credentials.delete(m.ref);
				break;
		}
		await this.persist();
		try {
			await this.onMutated?.();
		} catch {
			// 宿主回调失败不影响配置变更结果（变更已落盘）
		}
	}

	/** 写回磁盘 */
	private async persist(): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		const payload: PersistedConfig = {
			profiles: this.profiles,
			...(this.defaultProfileId !== undefined ? { defaultProfileId: this.defaultProfileId } : {}),
			...(this.runtime !== undefined ? { runtime: this.runtime } : {}),
			...(this.skillsDisabled !== undefined ? { skillsDisabled: this.skillsDisabled } : {}),
			...(this.mcpServers.length > 0 ? { mcpServers: this.mcpServers } : {}),
			...(this.server !== undefined ? { server: this.server } : {}),
			credentials: Object.fromEntries(this.credentials),
		};
		await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
	}

	/** 解析凭据明文（经 cipher 解密；缺失时 undefined）。仅供宿主进程本地使用，勿经 RPC 暴露。 */
	async resolveSecret(ref: CredentialRef): Promise<string | undefined> {
		const encrypted = this.credentials.get(ref);
		if (encrypted === undefined) return undefined;
		return this.cipher.decrypt(encrypted);
	}
}
