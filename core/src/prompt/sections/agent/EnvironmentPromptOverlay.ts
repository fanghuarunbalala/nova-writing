/**
 * 环境信息快照与 overlay 渲染（对应 CCB 环境信息块）。
 * Environment snapshot and overlay rendering (CCB environment-info counterpart).
 *
 * 环境块按 provider-call 刷新进 system prompt：日期一天一变，时区/平台/工作目录
 * 基本不变，模型解析失败时省略模型行。base 其余内容保持恒定。
 * The environment block refreshes into the system prompt per provider call: the
 * date changes daily, timezone/platform/workdir are effectively stable, and the
 * model line is omitted when model resolution fails. The rest of the base stays
 * constant.
 */
export interface EnvironmentInfoSnapshot {
  /** 时区，如 Asia/Shanghai。Timezone, e.g. Asia/Shanghai. */
  readonly timezone: string;
  /** 本地日期 YYYY-MM-DD。Local date YYYY-MM-DD. */
  readonly date: string;
  /** 平台显示名，如 macOS。Platform display name, e.g. macOS. */
  readonly platform: string;
  /** 模型 id；解析失败时省略。Model id; omitted when resolution fails. */
  readonly modelId?: string;
  /** 工作目录（文件系统路径）。Working directory (filesystem path). */
  readonly workdir: string;
}

/**
 * 运行时注入给动态环境段的静态环境数据（日期/时区/平台在渲染时现场计算）。
 * Static environment data injected into the dynamic environment section at
 * runtime (date/timezone/platform are computed at render time).
 */
export interface PromptEnvironmentSnapshot {
  /** 工作目录（文件系统路径）。Working directory (filesystem path). */
  readonly workdir: string;
  /** 平台显示名（host 提供），如 macOS。Platform display name from the host, e.g. macOS. */
  readonly platform: string;
  /** 模型 id；解析失败时省略。Model id; omitted when resolution fails. */
  readonly modelId?: string;
}

/**
 * 渲染环境信息块，恒定格式。
 * Renders the environment block with a constant format.
 */
export function renderEnvironmentOverlay(snapshot: EnvironmentInfoSnapshot): string {
  return [
    "# 环境信息",
    `- 当前日期：${snapshot.date}（${snapshot.timezone}）`,
    `- 平台：${snapshot.platform}`,
    ...(snapshot.modelId === undefined ? [] : [`- 模型：${snapshot.modelId}`]),
    // `- 工作目录：${snapshot.workdir}`,
  ].join("\n");
}

/**
 * 把环境块追加到 system prompt 末尾；base 为空时直接返回环境块。
 * Appends the environment block to the system prompt; returns only the block
 * when the base is empty.
 */
export function appendEnvironmentOverlay(
  systemPrompt: string,
  snapshot: EnvironmentInfoSnapshot,
): string {
  const overlay = renderEnvironmentOverlay(snapshot);
  return systemPrompt.length === 0 ? overlay : `${systemPrompt}\n\n${overlay}`;
}
