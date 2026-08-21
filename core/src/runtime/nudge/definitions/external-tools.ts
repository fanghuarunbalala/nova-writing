/**
 * external_tools nudge（docs/PRD/external-tools-接入.md F5）：
 * 延迟工具名单公告——persistent append 通道、每压缩纪元一次，对齐
 * cc 的 `<available-deferred-tools>` 公告（名单 + 两步流程 + 使用纪律）。
 *
 * 纪元 = 自上次压缩：compactionGeneration 变化或 messages 非空→空（clear 兜底）
 * → 重置已注入标记，下一输入重注；压缩链统一清扫带 nudge 标记的 system 消息
 * （LoopContext.sweepNudgeMessages + T2 摘要输入过滤），重注不重复。
 * 重启 seed-scan：journal 重放中已存在本标记消息 → 幂等不重发。
 * 注册表为空 → no-op（不注入）。transient 通道不使用（恒 false）。
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunProgress } from "../../loop/types.js";
import type { ProviderCall } from "../../provider/types.js";
import type { ContextNudgePolicy } from "../ContextNudgePolicy.js";
import type { DeferredToolRegistry } from "../../tool/deferred/DeferredToolRegistry.js";

/** 注入标记（压缩清扫/摘要过滤/seed-scan 识别用） */
export const EXTERNAL_TOOLS_NUDGE_MARK = "external_tools";

/** 渲染公告全文（延迟工具名单 + 两步流程 + 纪律） */
export function renderExternalToolsText(registry: DeferredToolRegistry): string {
  const names = registry.list().map((t) => t.name);
  return [
    "# 延迟工具可用性提醒",
    `以下 ${names.length} 个延迟工具（外部工具）可用，但它们不在你的工具列表中，不能直接调用：`,
    ...names.map((n) => `- ${n}`),
    "两步流程：",
    "1. SearchExtraTools 发现：{\"query\": \"select:工具名\"}（按名）；不确定名称用关键词搜索，或 \"discover:关键词\" 查看描述与参数 schema；",
    "2. ExecuteExtraTool 执行：{\"tool_name\": \"工具名\", \"params\": {...}}（参数按其 schema）。",
    "纪律：",
    "- 优先使用核心工具完成任务；只有核心工具无法完成时才使用延迟工具。",
    "- 直接调用延迟工具会被拒绝。",
    "- 非受信服务器工具执行时会征询用户审批。",
  ].join("\n");
}

/** ExternalToolsNudgePolicy 构造依赖 */
export interface ExternalToolsNudgeDeps {
  /** 延迟工具注册表（名单来源；空注册表不注入） */
  readonly registry: DeferredToolRegistry;
}

/**
 * 延迟工具名单公告策略：persistent 每纪元一次（curTurn===0 门控）；transient 不使用
 */
export class ExternalToolsNudgePolicy implements ContextNudgePolicy {
  private readonly registry: DeferredToolRegistry;
  /** 本纪元已注入（压缩/清空重置） */
  private injected = false;
  /** 首次求值 seed-scan 守卫（重启幂等） */
  private seeded = false;
  /** 上次观察的压缩代数（变化 = 纪元重置） */
  private lastCompactionGeneration = 0;
  /** 上次观察的 messages 数（非空→空 = clear 兜底） */
  private lastMessageCount = 0;

  constructor(deps: ExternalToolsNudgeDeps) {
    this.registry = deps.registry;
  }

  /**
   * 持久注入：run 首调用（curTurn===0）时，注册表非空且本纪元未注入过 → 追加公告。
   */
  persistentNudgeIfNeeded(loop: LoopContext, run: RunProgress): boolean {
    if (run.curTurn !== 0) {
      return false;
    }
    if (this.registry.size === 0) {
      return false;
    }
    this.seedFromRuns(loop);
    const generation = loop.compactionGeneration;
    const messageCount = loop.messages.length;
    const cleared = this.lastMessageCount > 0 && messageCount === 0;
    if (generation !== this.lastCompactionGeneration || cleared) {
      this.injected = false;
    }
    this.lastCompactionGeneration = generation;
    this.lastMessageCount = messageCount;
    if (this.injected) {
      return false;
    }
    this.injected = true;
    loop.appendRunMessages([
      {
        role: "system",
        content: renderExternalToolsText(this.registry),
        nudge: EXTERNAL_TOOLS_NUDGE_MARK,
      },
    ]);
    return true;
  }

  /** transient 通道不使用 */
  transientNudgeIfNeeded(_loop: LoopContext, _run: RunProgress, _call: ProviderCall): boolean {
    return false;
  }

  /** 首次求值：扫描恢复 runs 中本纪元已注入的公告（重启幂等，不重发） */
  private seedFromRuns(loop: LoopContext): void {
    if (this.seeded) {
      return;
    }
    this.seeded = true;
    for (const run of loop.runs) {
      for (const message of run.messages) {
        if (message.role === "system" && message.nudge === EXTERNAL_TOOLS_NUDGE_MARK) {
          this.injected = true;
          return;
        }
      }
    }
  }
}
