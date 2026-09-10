/**
 * 内置技能预装（builtin skills seeding）：启动时把 builtin-skills/<name>/ 整目录
 * 递归拷入应用级技能目录 <userData>/skills/<name>/；目标已存在一律跳过——
 * 用户编辑/禁用/删除优先，不覆盖、不复活。同步递归，仅启动调用一次。
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** 单个内置技能预装结果 */
export interface SeedResult {
  /** 内置技能名（目录名） */
  readonly name: string;
  /** 是否实际拷贝（false = 目标已存在跳过） */
  readonly seeded: boolean;
}

/**
 * 预装内置技能目录下全部技能。
 * @param builtinRoot 内置技能根目录（其下每个子目录是一个技能；说明文件 .md 忽略）
 * @param appSkillsRoot 应用级技能根目录（不存在则创建）
 * @returns 每个技能的预装结果（跳过 = 用户版本优先）
 */
export async function seedBuiltinSkills(
  builtinRoot: string,
  appSkillsRoot: string,
): Promise<readonly SeedResult[]> {
  let entries;
  try {
    entries = await readdir(builtinRoot, { withFileTypes: true });
  } catch {
    // 内置目录不存在（打包缺失等）：无技能可预装
    return [];
  }
  await mkdir(appSkillsRoot, { recursive: true });
  const results: SeedResult[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = join(appSkillsRoot, entry.name);
    if (existsSync(target)) {
      results.push({ name: entry.name, seeded: false });
      continue;
    }
    await cp(join(builtinRoot, entry.name), target, { recursive: true });
    results.push({ name: entry.name, seeded: true });
  }
  return results;
}
