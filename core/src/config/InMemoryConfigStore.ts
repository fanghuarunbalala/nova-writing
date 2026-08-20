/**
 * InMemoryConfigStore：内存版 ConfigStore（测试 / 无持久化）。
 */

import type {
	ConfigMutation,
	ConfigSnapshot,
	CredentialRef,
	CredentialStatus,
	ModelProfile,
	RuntimeSettings,
} from "./contract.js";
import {
  removeProfileReferences,
  validateModelCapabilities,
  validateRuntimeSettings,
} from "./runtimeSettings.js";
import { validateSkillsDisabled } from "./skillsSettings.js";
import type { ConfigStore } from "./store.js";

/** 内存版 config 存储（profile Map + 凭据 Map） */
export class InMemoryConfigStore implements ConfigStore {
  private readonly profiles = new Map<string, ModelProfile>();
  private defaultProfileId?: string;
  private readonly credentials = new Map<CredentialRef, string>();
  private runtime?: RuntimeSettings;
  private skillsDisabled?: string[];

	/** 读取配置快照 */
	async get(): Promise<ConfigSnapshot> {
		const credentials: Record<CredentialRef, CredentialStatus> = {};
		for (const ref of this.credentials.keys()) credentials[ref] = "present";
		return {
			profiles: Object.freeze([...this.profiles.values()]),
			...(this.defaultProfileId !== undefined ? { defaultProfileId: this.defaultProfileId } : {}),
			credentials: Object.freeze(credentials),
			...(this.runtime !== undefined ? { runtime: this.runtime } : {}),
			...(this.skillsDisabled !== undefined ? { skillsDisabled: this.skillsDisabled } : {}),
			diagnostics: { logLevel: "info" },
		};
	}

	/** 变更配置 */
	async mutate(m: ConfigMutation): Promise<void> {
		switch (m.op) {
			case "model.upsert": {
				const { capabilities, ...rest } = m.profile;
				const caps = validateModelCapabilities(capabilities);
				this.profiles.set(
					m.profileId,
					caps !== undefined ? { id: m.profileId, ...rest, capabilities: caps } : { id: m.profileId, ...rest },
				);
				if (this.defaultProfileId === undefined) this.defaultProfileId = m.profileId;
				break;
			}
			case "model.remove": {
				this.profiles.delete(m.profileId);
				if (this.defaultProfileId === m.profileId) {
					this.defaultProfileId = this.profiles.keys().next().value;
				}
				this.runtime = removeProfileReferences(this.runtime, m.profileId);
				break;
			}
			case "model.setDefault": {
				if (this.profiles.has(m.profileId)) this.defaultProfileId = m.profileId;
				break;
			}
			case "runtime.set": {
				this.runtime = validateRuntimeSettings(m.runtime, [...this.profiles.keys()]);
				break;
			}
			case "skills.setDisabled": {
				this.skillsDisabled = validateSkillsDisabled([...m.names]);
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

	/** 解析凭据明文（内存版直接返回存储值；缺失时 undefined） */
	async resolveSecret(ref: CredentialRef): Promise<string | undefined> {
		return this.credentials.get(ref);
	}
}
