/**
 * memory nudge（ContextNudgePolicy 实现，main agent 专属）。
 * docs/PRD/memory-案例参考.md v0.6（F2/F9）。
 *
 * 目录全文**每纪元 persistent 注入一次**（会话启动 / compact / clear 后首 run），
 * 复用 project_stage 纪元基建（压缩清扫 nudge 标记消息 → 纪元重置 → 重注入）。
 *
 * 纪元内不重发全文：
 * - MEMORY.yaml digest 变了且 version 没加（agent 忘 bump / 作者手改）→ 系统
 *   自动写回 version+1 自愈，随后按 version 不一致处理；
 * - version 与上次注入不一致 → 追加一条变更通知（±类目名，nudge=memory_delta）；
 * - presetDigest 不一致（作者手动/代码变更预设）→ 独立通知，不 bump version。
 *
 * 重启 seed-scan：从 runs 中 memory_full 消息恢复「已注入 + version」（幂等不重发）；
 * digest 基线重启重置（重启不视为内容变更）。读取/自愈失败静默跳过下次重试，
 * 绝不阻断 provider call。transient 通道不使用。
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunProgress } from "../../loop/types.js";
import type { ProviderCall } from "../../provider/types.js";
import type { ContextNudgePolicy } from "../ContextNudgePolicy.js";
import {
  MEMORY_INDEX_FILE,
  PRESET_ROOT,
  type MemoryIndex,
} from "../../../memory/index.js";
import { validateMemoryTree, type MemoryFileReader } from "../../../memory/index.js";
import {
  digestOf,
  diffIndexNames,
  diffPresetFiles,
  presetDigestOf,
  renderMemoryBlock,
} from "../../../memory/index.js";
import { createNodeFileReader } from "../../../memory/index.js";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

/** 目录全文注入标记（压缩清扫/摘要过滤/seed-scan 用） */
export const MEMORY_NUDGE_FULL = "memory_full";
/** 纪元内变更通知标记 */
export const MEMORY_NUDGE_DELTA = "memory_delta";

/** MemoryNudgePolicy 构造依赖 */
export interface MemoryNudgeDeps {
  /** 工作区绝对路径（MEMORY.yaml / .novel/references / .novel/preset 的根） */
  readonly workspace: string;
  /** 文件读取器（缺省 node fs；测试注入内存版） */
  readonly reader?: MemoryFileReader;
  /** 自愈写回（缺省 node fs 原子语义：直接覆写 MEMORY.yaml 仅 version 行） */
  readonly writeIndex?: (text: string) => Promise<void>;
}

/** 注入版提取（seed-scan：从已注入全文的 <memory version="N"> 恢复） */
function versionOfRendered(content: string): number | undefined {
  const m = /<memory version="(\d+)">/.exec(content);
  return m === null ? undefined : Number(m[1]);
}

/**
 * 记忆偏好案例库注入策略（persistent 纪元制 + version/presetDigest 自愈）
 */
export class MemoryNudgePolicy implements ContextNudgePolicy {
  private readonly workspace: string;
  private readonly reader: MemoryFileReader;
  private readonly writeIndex: (text: string) => Promise<void>;
  /** 本纪元是否已注入全文 */
  private injectedThisEpoch = false;
  /** seed-scan 守卫（重启幂等） */
  private seeded = false;
  /** 上次观察的压缩代数（变化 = 纪元重置） */
  private lastCompactionGeneration = 0;
  /** 上次观察的 messages 数（非空→空 = clear 兜底） */
  private lastMessageCount = 0;
  /** 摘要基线（注入时的 (version, indexDigest, presetDigest, indexSnapshot, presetPaths)） */
  private baseline:
    | {
        version: number;
        indexDigest: string;
        presetDigest: string;
        index: MemoryIndex;
        presetPaths: readonly string[];
      }
    | undefined;

  constructor(deps: MemoryNudgeDeps) {
    this.workspace = deps.workspace;
    this.reader = deps.reader ?? createNodeFileReader(deps.workspace);
    this.writeIndex =
      deps.writeIndex ??
      (async (text) => {
        await writeFile(join(deps.workspace, MEMORY_INDEX_FILE), text, "utf8");
      });
  }

  /**
   * 持久注入（run 首个 provider call，curTurn===0 门控）：
   * 纪元重置检查 → 读树校验 → 未注入则全文，已注入则摘要比对发变更通知。
   */
  async persistentNudgeIfNeeded(loop: LoopContext, run: RunProgress): Promise<boolean> {
    if (run.curTurn !== 0) {
      return false;
    }
    this.seedFromRuns(loop);
    const generation = loop.compactionGeneration;
    const messageCount = loop.messages.length;
    const cleared = this.lastMessageCount > 0 && messageCount === 0;
    if (generation !== this.lastCompactionGeneration || cleared) {
      this.injectedThisEpoch = false;
    }
    this.lastCompactionGeneration = generation;
    this.lastMessageCount = messageCount;

    let tree;
    try {
      tree = await validateMemoryTree(this.reader);
    } catch {
      return false;
    }
    const indexText = await this.reader.read(MEMORY_INDEX_FILE);
    const presetFiles = await this.collectPresetContents();
    const indexDigest = digestOf(indexText ?? "");
    const presetDigest = presetDigestOf(presetFiles);

    if (!this.injectedThisEpoch) {
      // 校验失败：注入修复指引（同样标记 full，纪元内不重复轰炸）
      const problems = tree.errors.length > 0 ? tree.errors : undefined;
      loop.appendRunMessages([
        {
          role: "system",
          content: renderMemoryBlock(tree.index, tree.presetEntries, problems),
          nudge: MEMORY_NUDGE_FULL,
        },
      ]);
      this.baseline = {
        version: tree.index.version,
        indexDigest,
        presetDigest,
        index: tree.index,
        presetPaths: presetFiles.map((f) => f.path),
      };
      this.injectedThisEpoch = true;
      return true;
    }

    const baseline = this.baseline;
    if (baseline === undefined) {
      return false;
    }
    if (baseline.indexDigest === "" || baseline.presetDigest === "") {
      // seed 恢复后首求值：摘要基线未知（重启不视为内容变更）——重建基线，不通知
      this.baseline = {
        version: tree.index.version,
        indexDigest,
        presetDigest,
        index: tree.index,
        presetPaths: presetFiles.map((f) => f.path),
      };
      return false;
    }
    const indexChanged = indexDigest !== baseline.indexDigest;
    const presetChanged = presetDigest !== baseline.presetDigest;
    if (!indexChanged && !presetChanged) {
      return false;
    }

    const notices: string[] = [];
    let currentIndex = tree.index;
    if (indexChanged) {
      let version = tree.index.version;
      if (version === baseline.version) {
        // 自愈：内容变了 version 没加（agent 忘 bump / 作者手改）→ 自动 +1
        version = baseline.version + 1;
        try {
          await this.bumpIndexVersion(version);
        } catch {
          return false; // 写回失败：静默跳过，下次重试
        }
        currentIndex = { ...tree.index, version };
      }
      if (version !== baseline.version) {
        const diff = diffIndexNames(baseline.index, currentIndex);
        notices.push(
          `【memory】MEMORY.yaml 已更新至 v${version}${diff === "" ? "" : `：${diff}`}${
            version > baseline.version + 1 ? "（版本跳变，注意核对）" : ""
          }；此前注入的目录如有出入，以最新文件为准，需要时 Read。`,
        );
      }
    }
    if (presetChanged) {
      const diff = diffPresetFiles(baseline.presetPaths, presetFiles.map((f) => f.path));
      notices.push(
        `【memory】预设已变更${diff === "" ? "" : `：${diff}`}（作者资产，只读）；需要时 Read 对应预设文件。`,
      );
    }

    this.baseline = {
      version: currentIndex.version,
      indexDigest,
      presetDigest,
      index: currentIndex,
      presetPaths: presetFiles.map((f) => f.path),
    };
    if (notices.length > 0) {
      loop.appendRunMessages([
        { role: "system", content: notices.join("\n"), nudge: MEMORY_NUDGE_DELTA },
      ]);
      return true;
    }
    return false;
  }

  /** transient 通道不使用 */
  transientNudgeIfNeeded(
    _loop: LoopContext,
    _run: RunProgress,
    _call: ProviderCall,
  ): boolean {
    return false;
  }

  /** 首次求值：扫描恢复本纪元已注入的 full（重启幂等，不重发；恢复 version 供 delta 基线） */
  private seedFromRuns(loop: LoopContext): void {
    if (this.seeded) {
      return;
    }
    this.seeded = true;
    for (const run of loop.runs) {
      for (const message of run.messages) {
        if (message.role === "system" && message.nudge === MEMORY_NUDGE_FULL) {
          this.injectedThisEpoch = true;
          const version = versionOfRendered(message.content);
          if (version !== undefined) {
            this.baseline = {
              version,
              indexDigest: "",
              presetDigest: "",
              index: { version },
              presetPaths: [],
            };
          }
        }
      }
    }
  }

  /** 收集 preset 文件内容（presetDigest 输入；两域子目录收集） */
  private async collectPresetContents(): Promise<
    ReadonlyArray<{ path: string; content: string }>
  > {
    const out: { path: string; content: string }[] = [];
    await this.collectDir(`${PRESET_ROOT}/prose`, out);
    await this.collectDir(`${PRESET_ROOT}/story`, out);
    return out;
  }

  private async collectDir(
    dir: string,
    out: { path: string; content: string }[],
  ): Promise<void> {
    for (const rel of await this.reader.list(dir)) {
      const content = await this.reader.read(rel);
      if (content !== undefined) {
        out.push({ path: rel, content });
      }
    }
  }

  /** 自愈写回：MEMORY.yaml 仅 version 行 +1（保留其余原文） */
  private async bumpIndexVersion(version: number): Promise<void> {
    const text = await this.reader.read(MEMORY_INDEX_FILE);
    if (text === undefined) {
      await this.writeIndex(`version: ${version}\n`);
      return;
    }
    const bumped = /^version:\s*\d+\s*$/m.test(text)
      ? text.replace(/^version:\s*\d+\s*$/m, `version: ${version}`)
      : `version: ${version}\n${text}`;
    await this.writeIndex(bumped);
  }
}
