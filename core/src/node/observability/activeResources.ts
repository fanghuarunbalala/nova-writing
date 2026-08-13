/**
 * 进程活跃资源采样：句柄消耗诊断（EMFILE "too many open files" 排查）。
 *
 * Windows/Node 上没有跨平台精确的 fd 计数，用 process.getActiveResourcesInfo()
 * 的活跃资源类型列表近似句柄画像——类型计数随运行期增长即可暴露泄漏源
 * （如 SQLite 连接、pino worker、FS watcher、pipe 等）。仅诊断用，无运行时路径。
 * Active-resource sampling: a lightweight approximation of handle consumption for
 * EMFILE diagnosis. Counts resource types via process.getActiveResourcesInfo();
 * a rising type over time reveals the leak source. Diagnostic only.
 */
import type { Logger } from "../../observability/index.js";

/** 采样结果的结构化描述。Structured description of one sample. */
export interface ActiveResourceSample {
  readonly total: number;
  /** 按数量降序的类型 Top N，如 ["FSREQCALLBACK:3", "PIPEWRAP:2"]。 */
  readonly top: readonly string[];
}

/** 采样上限类型数。Max resource types kept in the sample. */
const TOP_RESOURCE_TYPES = 8;

/** 采集当前进程活跃资源画像；getActiveResourcesInfo 不可用/异常时降级 total=0。 */
export function sampleActiveResources(): ActiveResourceSample {
  try {
    const infos =
      typeof process.getActiveResourcesInfo === "function"
        ? process.getActiveResourcesInfo()
        : [];
    const counts = new Map<string, number>();
    for (const type of infos) {
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const top = Object.freeze(
      [...counts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, TOP_RESOURCE_TYPES)
        .map(([type, count]) => `${type}:${count}`),
    );
    return Object.freeze({ total: infos.length, top });
  } catch {
    return Object.freeze({ total: 0, top: Object.freeze([]) });
  }
}

/** 采集并落一条句柄采样日志（debug 级）。Samples and logs one handle snapshot. */
export function logActiveResources(logger: Logger, label: string): void {
  const sample = sampleActiveResources();
  logger.debug("runtime_child.active_resources", {
    label,
    total: sample.total,
    top: sample.top.join(" "),
  });
}
