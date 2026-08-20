/**
 * 技能清单服务（设置页「技能」面板数据源）：main 进程实时扫描两级 skills 目录，
 * 合并 config 禁用名单，产出含生效/禁用状态的展示清单。复用 SkillRegistry 的
 * 扫描解析（同名覆盖、错误跳过）语义。
 */
import { SkillRegistry, type SkillScanError, type SkillSource } from "./SkillRegistry.js";

/** 技能清单条目（展示层） */
export interface SkillsListEntry {
  /** 技能名 */
  readonly name: string;
  /** 简介 */
  readonly description: string;
  /** 来源层级 */
  readonly source: SkillSource;
  /** 技能目录绝对路径 */
  readonly dir: string;
  /** 是否被禁用（生效 = !disabled） */
  readonly disabled: boolean;
}

/** 技能清单结果 */
export interface SkillsListResult {
  /** 应用级技能根目录（空态提示用） */
  readonly appRoot: string;
  /** 项目级技能根目录（未开工作区时缺省） */
  readonly projectRoot?: string;
  /** 全部已发现技能（按名排序；生效置前由展示层处理） */
  readonly skills: readonly SkillsListEntry[];
  /** 扫描失败条目（诊断展示） */
  readonly errors: readonly SkillScanError[];
}

/**
 * 扫描并组装技能清单。
 * @param options 应用级根目录 + 项目级根目录（可选）+ 禁用名单
 * @returns 技能清单
 */
export async function listSkills(options: {
  appRoot: string;
  projectRoot?: string;
  disabled: readonly string[];
}): Promise<SkillsListResult> {
  const disabledSet = new Set(options.disabled);
  const registry = new SkillRegistry({
    dirs: [
      { root: options.appRoot, source: "app" },
      ...(options.projectRoot !== undefined
        ? [{ root: options.projectRoot, source: "project" as const }]
        : []),
    ],
    disabled: options.disabled,
  });
  await registry.load();
  return {
    appRoot: options.appRoot,
    ...(options.projectRoot !== undefined ? { projectRoot: options.projectRoot } : {}),
    skills: registry.list().map((s) => ({
      name: s.name,
      description: s.description,
      source: s.source,
      dir: s.dir,
      disabled: disabledSet.has(s.name),
    })),
    errors: registry.scanErrors(),
  };
}
