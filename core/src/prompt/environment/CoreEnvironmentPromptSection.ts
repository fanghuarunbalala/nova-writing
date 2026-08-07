/**
 * core.environment 动态段：运行时每调用渲染环境信息块。
 * Core environment dynamic section: renders the environment block per call.
 *
 * 日期/时区在渲染时现场计算（ECMAScript 标准能力）；工作目录/平台/模型 id 来自
 * 动态段输入（host 注入）。编译期（无输入）不产生内容。
 * Date/timezone are computed at render time via standard ECMAScript;
 * workdir/platform/model id come from the dynamic section input (host-injected).
 * Compile time (no input) yields no content.
 */
import { DynamicPromptSection, type DynamicPromptSectionInput } from "../section/DynamicPromptSection.js";
import { renderEnvironmentOverlay } from "./EnvironmentPromptOverlay.js";

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

export class CoreEnvironmentPromptSection extends DynamicPromptSection {
  constructor() {
    super({
      id: "core.environment",
      version: "1.0.0",
      label: "Core Environment",
    });
  }

  /** 编译期不产生内容（动态段不进 base）。No content at compile time (dynamic sections never enter the base). */
  override render(): string {
    return "";
  }

  /** 每调用渲染环境信息块；输入缺失时返回空串。Renders the environment block per call; empty when the input is absent. */
  override renderDynamic(input: DynamicPromptSectionInput): string {
    const environment = input.environment;
    if (
      environment === undefined ||
      environment.workdir.trim().length === 0 ||
      environment.platform.trim().length === 0
    ) {
      return "";
    }
    return renderEnvironmentOverlay({
      timezone: resolveTimezone(),
      date: resolveLocalDate(),
      platform: environment.platform,
      workdir: environment.workdir,
      ...(environment.modelId === undefined
        ? {}
        : { modelId: environment.modelId }),
    });
  }
}
