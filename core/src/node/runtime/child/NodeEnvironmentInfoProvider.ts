/**
 * Node host 环境信息提供者：日期/时区/平台/工作目录/模型。
 * Node-host environment info provider: date, timezone, platform, workdir, model.
 *
 * 模型经 EffectiveModelExecutionResolver 惰性解析，失败时降级为省略模型行；
 * 日志只记错误名，不暴露内部细节（AGENTS.md 脱敏规范）。
 * The model is lazily resolved through EffectiveModelExecutionResolver and the
 * model line is omitted on failure; logs keep only the error name (redaction).
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type {
  EnvironmentInfoProvider,
  EnvironmentInfoSnapshot,
} from "../../../prompt/index.js";

export interface NodeEnvironmentInfoProviderOptions {
  /** 工作目录（来自 runtime bootstrap）。Working directory from the runtime bootstrap. */
  readonly workdir: string;
  /** 模型 id 解析回调；失败返回 undefined。Model id resolver; undefined on failure. */
  readonly resolveModelId?: () => Promise<string | undefined>;
  readonly logger?: Logger;
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
});

function resolveTimezone(): string {
  try {
    const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timezone === "string" && timezone.length > 0
      ? timezone
      : "UTC";
  } catch {
    return "UTC";
  }
}

function resolveLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class NodeEnvironmentInfoProvider implements EnvironmentInfoProvider {
  readonly #workdir: string;
  readonly #resolveModelId?: () => Promise<string | undefined>;
  readonly #logger: Logger;

  constructor(options: NodeEnvironmentInfoProviderOptions) {
    this.#workdir = options.workdir;
    this.#resolveModelId = options.resolveModelId;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "node_environment_info_provider",
    });
  }

  /** 取一次快照：模型解析失败时省略模型行。Returns one snapshot; model line omitted on resolution failure. */
  async snapshot(): Promise<EnvironmentInfoSnapshot> {
    const modelId = await this.#resolveModelIdSafe();
    const timezone = resolveTimezone();
    const date = resolveLocalDate();
    const platform = PLATFORM_LABELS[process.platform] ?? process.platform;
    const base: EnvironmentInfoSnapshot = Object.freeze({
      timezone,
      date,
      platform,
      workdir: this.#workdir,
    });
    this.#logger.debug("environment.snapshot_resolved", {
      timezone,
      date,
      platform,
      hasModel: modelId !== undefined,
    });
    return modelId === undefined
      ? base
      : Object.freeze({ ...base, modelId });
  }

  async #resolveModelIdSafe(): Promise<string | undefined> {
    if (this.#resolveModelId === undefined) {
      return undefined;
    }
    try {
      return await this.#resolveModelId();
    } catch (error) {
      this.#logger.debug("environment.model_resolution_failed", {
        failure: error instanceof Error ? error.name : "unknown",
      });
      return undefined;
    }
  }
}
