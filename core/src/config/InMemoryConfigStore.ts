/**
 * InMemoryConfigStore：内存版 ConfigStore（测试 / 无持久化）。
 */

import type {
	ConfigMutation,
	ConfigSnapshot,
	CredentialRef,
	CredentialStatus,
	ModelProfile,
} from "./contract.js";
import type { ConfigStore } from "./store.js";

/** 内存版 config 存储（profile Map + 凭据 Map） */
export class InMemoryConfigStore implements ConfigStore {
	private readonly profiles = new Map<string, ModelProfile>();
	private defaultProfileId?: string;
	private readonly credentials = new Map<CredentialRef, string>();

	/** 读取配置快照 */
	async get(): Promise<ConfigSnapshot> {
		const credentials: Record<CredentialRef, CredentialStatus> = {};
		for (const ref of this.credentials.keys()) credentials[ref] = "present";
		return {
			profiles: Object.freeze([...this.profiles.values()]),
			...(this.defaultProfileId !== undefined ? { defaultProfileId: this.defaultProfileId } : {}),
			credentials: Object.freeze(credentials),
			diagnostics: { logLevel: "info" },
		};
	}

	/** 变更配置 */
	async mutate(m: ConfigMutation): Promise<void> {
		switch (m.op) {
			case "model.upsert": {
				this.profiles.set(m.profileId, { id: m.profileId, ...m.profile });
				if (this.defaultProfileId === undefined) this.defaultProfileId = m.profileId;
				break;
			}
			case "model.remove": {
				this.profiles.delete(m.profileId);
				if (this.defaultProfileId === m.profileId) {
					this.defaultProfileId = this.profiles.keys().next().value;
				}
				break;
			}
			case "model.setDefault": {
				if (this.profiles.has(m.profileId)) this.defaultProfileId = m.profileId;
				break;
			}
			case "credential.save": {
				this.credentials.set(m.ref, m.secret);
				break;
			}
			case "credential.delete": {
				this.credentials.delete(m.ref);
				break;
			}
		}
	}
}
