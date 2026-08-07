/**
 * Compose 工具服务：进入（建 design 文件 + 状态迁移 + 事件）与批准后落库收口。
 * Compose tool service: entering (design file + state transition + event) and
 * post-approval settlement.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  ComposeModeStateProvider,
  NovelComposeOutputEvent,
  type ComposeModePhase,
} from "../../../runtime/compose/index.js";
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

export interface ComposeToolServiceOptions {
  readonly composeState: ComposeModeStateProvider;
  readonly designRoot: string;
  readonly eventSink?: RuntimeEventSink;
  /** 批准后写入审计记录的可选 recorder。Optional audit recorder for approved commits. */
  readonly commitRecorder?: NovelComposeCommitRecorder;
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
  readonly preComposeMode?: string;
};

/** 提供 Enter/ExitComposeMode 的 provider-neutral 服务。 */
/** Provider-neutral service backing the Enter/ExitComposeMode tools. */
export class ComposeToolService {
  readonly #composeState: ComposeModeStateProvider;
  readonly #designRoot: string;
  readonly #eventSink: RuntimeEventSink;
  readonly #commitRecorder: NovelComposeCommitRecorder | undefined;
  readonly #logger: Logger;

  constructor(options: ComposeToolServiceOptions) {
    this.#composeState = options.composeState;
    this.#designRoot = path.resolve(options.designRoot);
    this.#eventSink = options.eventSink ?? NOOP_RUNTIME_EVENT_SINK;
    this.#commitRecorder = options.commitRecorder;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "novel_compose_tool_service",
    });
  }

  /** 会话 design 文件路径。Per-conversation design file path. */
  designFilePathFor(conversationId: string): string {
    const safe = conversationId.replace(/[^A-Za-z0-9._-]/g, "-");
    return path.join(this.#designRoot, `${safe}.md`);
  }

  /** 进入 compose：建空 design 文件、状态到 designing、发 begin 事件。 */
  /** Enters compose: creates the design file, transitions to designing, emits begin. */
  async begin(
    conversationId: string,
    purpose?: string,
  ): Promise<ComposeEnterDetails> {
    const designFilePath = this.designFilePathFor(conversationId);
    await fs.mkdir(this.#designRoot, { recursive: true });
    try {
      await fs.access(designFilePath);
    } catch {
      await fs.writeFile(designFilePath, "", "utf8");
    }
    const snapshot = this.#composeState.enter(conversationId, {
      designFilePath,
    });
    await this.#emit(conversationId, "compose.begin", {
      designFilePath,
      phase: snapshot.phase,
    });
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

  /** 批准后的落库收口：状态到 applied、发 applied 事件（handler 在批准后执行）。 */
  /** Post-approval settlement: transitions to applied and emits applied (handler runs after approval). */
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
    await this.#emit(conversationId, "compose.applied", {
      designFilePath,
      phase: snapshot.phase,
      ...(snapshot.preComposeMode === undefined
        ? {}
        : { preComposeMode: snapshot.preComposeMode }),
    });
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

  async #emit(
    conversationId: string,
    eventName: "compose.begin" | "compose.applied",
    payload: { designFilePath: string; phase: ComposeModePhase },
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
