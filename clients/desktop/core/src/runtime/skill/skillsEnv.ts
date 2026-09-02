/**
 * 技能设置 env 描述符（main → conversation 子进程下发）。
 * main 侧在启动/配置变更时序列化写 `NOVEL_SKILLS_SETTINGS`（应用级技能根目录
 * + 禁用名单）；子进程 spawn 时解析（项目级目录 = `<workspace>/skills` 由子进程
 * 自行派生——workspace 每会话不同，main 不在此处感知）。非法/缺失返回 undefined
 * 回退「技能系统未装配」。风格对齐 config/runtimeSettings.ts 的
 * parseRuntimeSettingsEnv。
 */
import type { SkillDir } from "./SkillRegistry.js";
import { join } from "node:path";

/** 技能设置 env 名 */
export const SKILLS_SETTINGS_ENV = "NOVEL_SKILLS_SETTINGS" as const;

/** 项目级技能目录名（工作区下） */
export const PROJECT_SKILLS_DIR_NAME = "skills" as const;

/** 技能设置 env 描述符 */
export interface SkillsEnvDescriptor {
  /** 应用级技能根目录（`<userData>/skills`；缺省不装载应用级） */
  readonly appSkillsRoot?: string;
  /** 禁用技能名单（config skillsDisabled） */
  readonly disabled: readonly string[];
}

/** 序列化为 env 值（JSON） */
export function serializeSkillsEnv(descriptor: SkillsEnvDescriptor): string {
  return JSON.stringify(descriptor);
}

/**
 * 解析 env 值（缺省/非法返回 undefined；名单内非法项过滤）。
 * @param raw env 原文
 * @returns 描述符
 */
export function parseSkillsEnv(raw: string | undefined): SkillsEnvDescriptor | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  const appSkillsRoot =
    typeof record.appSkillsRoot === "string" && record.appSkillsRoot.trim().length > 0
      ? record.appSkillsRoot
      : undefined;
  const disabled = Array.isArray(record.disabled)
    ? record.disabled.filter((name): name is string => typeof name === "string")
    : [];
  return { ...(appSkillsRoot !== undefined ? { appSkillsRoot } : {}), disabled };
}

/**
 * 派生技能目录列表（app 级 + project 级；后者同名覆盖前者）。
 * @param descriptor env 描述符
 * @param workspace 会话工作区路径
 * @returns 目录列表（构造 SkillRegistry 用）
 */
export function resolveSkillDirs(descriptor: SkillsEnvDescriptor, workspace: string): SkillDir[] {
  return [
    ...(descriptor.appSkillsRoot !== undefined
      ? [{ root: descriptor.appSkillsRoot, source: "app" as const }]
      : []),
    { root: join(workspace, PROJECT_SKILLS_DIR_NAME), source: "project" as const },
  ];
}
