/**
 * Compose 工具服务:进入/退出 compose + 会话 mode(review/bypass/compose)迁移的统一服务。
 * Compose tool service: unified service backing the Enter/ExitComposeMode tools
 * and the persistent per-conversation mode (review / bypass / compose).
 *
 * 写序(write-ahead):每次模式迁移 = ①内存状态迁移 → ②持久化 DB → ③发同步事件。
 * DB 写是提交点;DB 写失败则整个操作中止、不发事件(杜绝幻影事件)。事件只是持久化结果的广播。
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  ComposeModeStateProvider,
  DEFAULT_CONVERSATION_MODE,
  NovelComposeOutputEvent,
  type ComposeModePhase,
  type ConversationMode,
  type NovelComposeOutputPayloadOptions,
} from "../../../runtime/compose/index.js";
import type {
  ConversationComposeState,
  ConversationMetadata,
} from "../../../storage/index.js";
import type {
  RuntimeEventAppendReceipt,
  RuntimeEventSink,
} from "../../../runtime/execution/event/index.js";

const NOOP_RUNTIME_EVENT_SINK: RuntimeEventSink = Object.freeze({
  async append(): Promise<RuntimeEventAppendReceipt> {
    return Object.freeze({
      status: "recorded",
      conversationId: "",
      eventId: "",
      sequence: 0,
      recordedAt: "",
    });
  },
});

/** 会话 mode + compose 子状态的持久化端口(workspace DB 为权威来源)。 */
/** Persistence port for conversation mode + active compose sub-state (workspace DB is authoritative). */
export interface ConversationModePersistencePort {
  getConversationMetadata(
    conversationId: string,
  ): Promise<ConversationMetadata | undefined>;
  setConversationMode(
    conversationId: string,
    mode: ConversationMode,
  ): Promise<ConversationMetadata>;
  getConversationComposeState(
    conversationId: string,
  ): Promise<ConversationComposeState | undefined>;
  setConversationComposeState(
    conversationId: string,
    state: ConversationComposeState | undefined,
  ): Promise<void>;
}

export interface ComposeToolServiceOptions {
  readonly composeState: ComposeModeStateProvider;
  readonly designRoot: string;
  readonly eventSink?: RuntimeEventSink;
  /** 批准后写入审计记录的可选 recorder。Optional audit recorder for approved commits. */
  readonly commitRecorder?: NovelComposeCommitRecorder;
  /** 会话 mode + compose 子状态的持久化端口(可选,不传则仅内存 + 事件)。 */
  readonly conversations?: ConversationModePersistencePort;
  readonly logger?: Logger;
}

export interface NovelComposeCommitRecord {
  readonly designId: string;
  readonly conversationId: string;
  readonly approvedAt: string;
  readonly revisionBase?: string;
  readonly contentDigest: string;
  readonly archivePath: string;
}

export interface NovelComposeCommitRecorder {
  record(record: NovelComposeCommitRecord): Promise<void>;
}

export type ComposeEnterDetails = {
  readonly designFilePath: string;
  readonly phase: ComposeModePhase;
  readonly purpose?: string;
};

export type ComposeExitDetails = {
  readonly designFilePath: string;
  readonly phase: ComposeModePhase;
  readonly preComposeMode?: ConversationMode;
};

/** 提供 Enter/ExitComposeMode + mode 迁移的 provider-neutral 服务。 */
/** Provider-neutral service backing the Enter/ExitComposeMode tools and mode transitions. */
export class ComposeToolService {
  readonly #composeState: ComposeModeStateProvider;
  readonly #designRoot: string;
  readonly #eventSink: RuntimeEventSink;
  readonly #commitRecorder: NovelComposeCommitRecorder | undefined;
  readonly #conversations: ConversationModePersistencePort | undefined;
  readonly #logger: Logger;

  constructor(options: ComposeToolServiceOptions) {
    this.#composeState = options.composeState;
    this.#designRoot = path.resolve(options.designRoot);
    this.#eventSink = options.eventSink ?? NOOP_RUNTIME_EVENT_SINK;
    this.#commitRecorder = options.commitRecorder;
    this.#conversations = options.conversations;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "novel_compose_tool_service",
    });
  }

  /** 会话 design 文件路径。Per-conversation design file path. */
  designFilePathFor(conversationId: string): string {
    const safe = conversationId.replace(/[^A-Za-z0-9._-]/g, "-");
    return path.join(this.#designRoot, `${safe}.md`);
  }

  /** 进入 compose:建空 design 文件、状态到 designing、持久化、发 begin + mode.changed。 */
  /** Enters compose: creates the design file, transitions to designing, persists, emits begin + mode.changed. */
  async begin(
    conversationId: string,
    purpose?: string,
  ): Promise<ComposeEnterDetails> {
    const designFilePath = this.designFilePathFor(conversationId);
    await fs.mkdir(this.#designRoot, { recursive: true });
    // 检测旧草稿：design 文件已存在 = 上次会话残留（discard 才删、exit 归档）。用于
    // reentry 提醒。Draft exists when the design file already exists (only discard
    // deletes it; exit archives it) — drives the reentry reminder.
    let hasPriorDraft = false;
    try {
      await fs.access(designFilePath);
      hasPriorDraft = true;
    } catch {
      await fs.writeFile(designFilePath, "", "utf8");
    }
    const currentMode = this.#composeState.snapshot(conversationId).mode;
    const snapshot = this.#composeState.enter(conversationId, {
      designFilePath,
      preComposeMode: currentMode,
      hasPriorDraft,
    });
    // 写序: ①内存 → ②DB(提交点) → ③事件。
    await this.#persistMode(conversationId, "compose");
    await this.#persistComposeState(conversationId, {
      phase: snapshot.phase as "designing",
      designFilePath,
      preMode: snapshot.preComposeMode ?? DEFAULT_CONVERSATION_MODE,
      updatedAt: new Date().toISOString(),
    });
    await this.#emit(conversationId, "compose.begin", {
      designFilePath,
      phase: snapshot.phase,
    });
    await this.#emitModeChanged(conversationId, "compose");
    this.#logger.info("novel_compose.begin", {
      conversationId,
      phase: snapshot.phase,
    });
    return Object.freeze({
      designFilePath,
      phase: snapshot.phase,
      ...(purpose === undefined ? {} : { purpose }),
    });
  }

  /** 批准后的落库收口:状态到 applied、持久化恢复、删 compose 子状态、发 applied + mode.changed。 */
  /** Post-approval settlement: transitions to applied, restores mode, clears compose sub-state, emits applied + mode.changed. */
  async exit(conversationId: string): Promise<ComposeExitDetails> {
    const snapshot = this.#composeState.approve(conversationId);
    const designFilePath = snapshot.designFilePath ?? "";
    let contentDigest = "";
    let archivePath = "";
    if (designFilePath !== "") {
      try {
        const content = await fs.readFile(designFilePath, "utf8");
        contentDigest = createHash("sha256").update(content).digest("hex");
        const archiveDir = path.join(this.#designRoot, "archive");
        await fs.mkdir(archiveDir, { recursive: true });
        archivePath = path.join(archiveDir, path.basename(designFilePath));
        await fs.rename(designFilePath, archivePath);
      } catch (error) {
        this.#logger.debug("novel_compose.archive_skipped", {
          conversationId,
        });
      }
    }
    if (this.#commitRecorder !== undefined && contentDigest !== "") {
      await this.#commitRecorder.record({
        designId: path.basename(designFilePath, ".md"),
        conversationId,
        approvedAt: new Date().toISOString(),
        contentDigest,
        archivePath,
      });
    }
    const mode = snapshot.preComposeMode ?? DEFAULT_CONVERSATION_MODE;
    // 写序: ①内存 → ②DB(提交点) → ③事件。
    await this.#persistMode(conversationId, mode);
    await this.#persistComposeState(conversationId, undefined);
    await this.#emit(conversationId, "compose.applied", {
      designFilePath,
      phase: snapshot.phase,
      ...(snapshot.preComposeMode === undefined
        ? {}
        : { preComposeMode: snapshot.preComposeMode }),
    });
    await this.#emitModeChanged(conversationId, mode);
    this.#composeState.settle(conversationId);
    this.#logger.info("novel_compose.applied", {
      conversationId,
      phase: snapshot.phase,
    });
    return Object.freeze({
      designFilePath,
      phase: snapshot.phase,
      ...(snapshot.preComposeMode === undefined
        ? {}
        : { preComposeMode: snapshot.preComposeMode }),
    });
  }

  /** 用户主动切换 mode 的统一入口(前端 IPC / 其余 tool 共用)。compose 目标走 begin;其余走 setMode。 */
  /** Unified mode-switch entry (frontend IPC / other tools). compose target begins; others setMode. */
  async setMode(conversationId: string, target: ConversationMode): Promise<void> {
    if (target === "compose") {
      await this.begin(conversationId);
      return;
    }
    const current = this.#composeState.snapshot(conversationId);
    if (current.active) {
      // 用户主动退出 compose:discard 路径(不走审批门), 落最终 target。
      await this.#discardActive(conversationId, target);
      this.#composeState.setMode(conversationId, target);
      return;
    }
    if (current.mode === target) return;
    const snapshot = this.#composeState.setMode(conversationId, target);
    await this.#persistMode(conversationId, target);
    await this.#emitModeChanged(conversationId, target);
    this.#logger.info("novel_compose.mode_set", {
      conversationId,
      mode: snapshot.mode,
    });
  }

  /** 主动放弃 compose 会话(不走审批门):恢复 preMode、删 design 文件、清 compose 子状态、发 discarded + mode.changed。 */
  /** Actively discards an active compose session (no approval gate). */
  async discard(conversationId: string): Promise<void> {
    const current = this.#composeState.snapshot(conversationId);
    if (!current.active) return;
    const preMode = current.preComposeMode ?? DEFAULT_CONVERSATION_MODE;
    await this.#discardActive(conversationId, preMode);
  }

  /** 从持久层还原会话 mode + compose 子状态(重启恢复;不依赖事件,权威来源)。 */
  /** Restores conversation mode + compose sub-state from persistence on startup. */
  async hydrate(conversationId: string): Promise<void> {
    if (this.#conversations === undefined) return;
    const metadata = await this.#conversations.getConversationMetadata(
      conversationId,
    );
    const mode = metadata?.mode ?? DEFAULT_CONVERSATION_MODE;
    if (mode === "compose") {
      const composeState =
        await this.#conversations.getConversationComposeState(conversationId);
      if (composeState === undefined) {
        // 孤儿 compose 模式且无子状态行:防御性回退 review,避免卡死在 compose 而无法恢复。
        await this.#conversations.setConversationMode(conversationId, "review");
        this.#composeState.setMode(conversationId, "review");
        return;
      }
      this.#composeState.enter(conversationId, {
        designFilePath: composeState.designFilePath,
        preComposeMode: composeState.preMode,
      });
      if (composeState.phase === "pending") {
        this.#composeState.submit(conversationId);
      }
      return;
    }
    this.#composeState.setMode(conversationId, mode);
  }

  async #discardActive(
    conversationId: string,
    persistMode: ConversationMode,
  ): Promise<void> {
    const discarded = this.#composeState.discard(conversationId);
    await this.#deleteDesignFile(discarded.designFilePath);
    // 写序: ①内存 → ②DB(提交点) → ③事件。
    await this.#persistMode(conversationId, persistMode);
    await this.#persistComposeState(conversationId, undefined);
    await this.#emit(conversationId, "compose.discarded", {
      designFilePath: discarded.designFilePath ?? "",
      phase: discarded.phase,
      ...(discarded.preComposeMode === undefined
        ? {}
        : { preComposeMode: discarded.preComposeMode }),
    });
    await this.#emitModeChanged(conversationId, persistMode);
    this.#logger.info("novel_compose.discarded", {
      conversationId,
      phase: discarded.phase,
    });
  }

  async #persistMode(
    conversationId: string,
    mode: ConversationMode,
  ): Promise<void> {
    if (this.#conversations === undefined) return;
    await this.#conversations.setConversationMode(conversationId, mode);
  }

  async #persistComposeState(
    conversationId: string,
    state: ConversationComposeState | undefined,
  ): Promise<void> {
    if (this.#conversations === undefined) return;
    await this.#conversations.setConversationComposeState(conversationId, state);
  }

  async #deleteDesignFile(designFilePath: string | undefined): Promise<void> {
    if (designFilePath === undefined || designFilePath === "") return;
    try {
      await fs.rm(designFilePath, { force: true });
    } catch (error) {
      this.#logger.debug("novel_compose.discard_cleanup_skipped", {
        designFilePath,
      });
    }
  }

  async #emitModeChanged(
    conversationId: string,
    mode: ConversationMode,
  ): Promise<void> {
    await this.#emit(conversationId, "mode.changed", { mode });
  }

  async #emit(
    conversationId: string,
    eventName:
      | "compose.begin"
      | "compose.applied"
      | "compose.discarded"
      | "mode.changed",
    payload: NovelComposeOutputPayloadOptions,
  ): Promise<void> {
    await this.#eventSink.append(
      new NovelComposeOutputEvent({
        eventName,
        conversationId,
        payload,
      }),
    );
  }
}
