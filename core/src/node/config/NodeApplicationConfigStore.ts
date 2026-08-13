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
	ModelProfile,
} from "../../config/contract.js";

/** node config store 构造选项 */
export interface NodeApplicationConfigStoreOptions {
	/** 配置文件路径 */
	filePath: string
	/** 凭据加密器 */
	cipher: CredentialCipher
}

/** 落盘结构 */
interface PersistedConfig {
	profiles: ModelProfile[]
	defaultProfileId?: string
	credentials: Record<CredentialRef, string>
}

/** JSON 文件版 config 存储（load 读 / mutate 写回） */
export class NodeApplicationConfigStore implements ConfigStore {
	private readonly filePath: string;
	private readonly cipher: CredentialCipher;
	private profiles: ModelProfile[] = [];
	private defaultProfileId?: string;
	private credentials = new Map<CredentialRef, string>();

	/**
	 * @param options 文件路径 + 加密器
	 */
	constructor(options: NodeApplicationConfigStoreOptions) {
		this.filePath = options.filePath;
		this.cipher = options.cipher;
	}

	/** 从磁盘加载（文件缺失则空配置） */
	async load(): Promise<void> {
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = JSON.parse(raw) as PersistedConfig;
			this.profiles = parsed.profiles ?? [];
			this.defaultProfileId = parsed.defaultProfileId;
			this.credentials = new Map(Object.entries(parsed.credentials ?? {}));
		} catch {
			this.profiles = [];
			this.defaultProfileId = undefined;
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
			diagnostics: { logLevel: "info" },
		};
	}

	/** 变更配置并落盘 */
	async mutate(m: ConfigMutation): Promise<void> {
		switch (m.op) {
			case "model.upsert":
				this.profiles = this.profiles.filter((p) => p.id !== m.profileId);
				this.profiles.push({ id: m.profileId, ...m.profile });
				if (this.defaultProfileId === undefined) this.defaultProfileId = m.profileId;
				break;
			case "model.remove":
				this.profiles = this.profiles.filter((p) => p.id !== m.profileId);
				if (this.defaultProfileId === m.profileId) {
					this.defaultProfileId = this.profiles[0]?.id;
				}
				break;
			case "model.setDefault":
				if (this.profiles.some((p) => p.id === m.profileId)) this.defaultProfileId = m.profileId;
				break;
			case "credential.save":
				this.credentials.set(m.ref, await this.cipher.encrypt(m.secret));
				break;
			case "credential.delete":
				this.credentials.delete(m.ref);
				break;
		}
		await this.persist();
	}

	/** 写回磁盘 */
	private async persist(): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		const payload: PersistedConfig = {
			profiles: this.profiles,
			...(this.defaultProfileId !== undefined ? { defaultProfileId: this.defaultProfileId } : {}),
			credentials: Object.fromEntries(this.credentials),
		};
		await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
	}
}
