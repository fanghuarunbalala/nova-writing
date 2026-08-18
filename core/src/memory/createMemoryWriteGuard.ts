/**
 * memory 写守卫（PRD F5/F10）：files 工具（Write/Edit）的注入项。
 *
 * - protectedPrefixes：Write/Edit 命中即拒绝（预设硬闸——工具层强制，不靠 prompt）。
 * - afterWrite：memory 文件写入后立即做全树动态编译校验，错误附在工具结果里
 *   构成 agent 修复环；预设文件错误文案指向作者。
 */
import { join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { PRESET_ROOT, REFERENCES_ROOT, MEMORY_INDEX_FILE } from "./memorySchema.js";
import { validateMemoryTree, type MemoryFileReader } from "./memoryValidator.js";

/** files 工具写守卫接口（files.ts 只依赖此形状，不依赖 memory 实现） */
export interface FileWriteGuard {
  /** 受保护路径前缀（workspace 相对，/ 分隔）；命中 → 拒绝执行 */
  readonly protectedPrefixes: readonly string[];
  /** 写后校验：返回需呈现在工具结果里的问题列表（空 = 通过） */
  afterWrite(relPath: string): Promise<string[]>;
}

/** node fs 文件读取器（生产实现；测试注入内存版） */
export function createNodeFileReader(workspace: string): MemoryFileReader {
  const read = async (rel: string): Promise<string | undefined> => {
    try {
      return await readFile(join(workspace, rel), "utf8");
    } catch {
      return undefined;
    }
  };
  const list = async (relDir: string): Promise<string[]> => {
    let entries;
    try {
      entries = await readdir(join(workspace, relDir), { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      const rel = `${relDir}/${e.name}`;
      if (e.isFile()) {
        out.push(rel);
      } else if (e.isDirectory()) {
        out.push(...(await list(rel)));
      }
    }
    return out;
  };
  return { read, list };
}

/** 该路径是否属于 memory 动态体系（写后校验范围） */
export function isDynamicMemoryPath(relPath: string): boolean {
  return relPath === MEMORY_INDEX_FILE || relPath.startsWith(`${REFERENCES_ROOT}/`);
}

/**
 * 创建 memory 写守卫（runtime.files 组装配；analyst.files 不装配——书库工作区无 memory 体系）。
 */
export function createMemoryWriteGuard(workspace: string, reader?: MemoryFileReader): FileWriteGuard {
  const fileReader = reader ?? createNodeFileReader(workspace);
  return {
    protectedPrefixes: Object.freeze([PRESET_ROOT]),
    afterWrite: async (relPath) => {
      if (!isDynamicMemoryPath(relPath)) {
        return [];
      }
      const tree = await validateMemoryTree(fileReader);
      const problems = [...tree.errors];
      if (problems.length > 0) {
        return problems.slice(0, 12);
      }
      return [];
    },
  };
}
