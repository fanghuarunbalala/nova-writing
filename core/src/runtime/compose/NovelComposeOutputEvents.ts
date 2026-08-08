/**
 * novel.compose.* 输出事件：阶段状态变化的事件载体（payload 脱敏，不含正文内容）。
 * Novel compose output events: phase-transition event carriers (payloads are
 * redacted and never include design file content).
 */
import {
  NovelOutputEvent,
  OutputPayload,
  type JsonObject,
  type OutputEventOptions,
} from "../../event/index.js";
import type { ConversationMode } from "./ConversationMode.js";
import type { ComposeModePhase } from "./ComposeModeState.js";

export type NovelComposeEventName =
  | "compose.begin"
  | "compose.submitted"
  | "compose.approved"
  | "compose.rejected"
  | "compose.applied"
  | "compose.discarded"
  | "mode.changed";

export interface NovelComposeOutputPayloadOptions {
  readonly designFilePath?: string;
  readonly phase?: ComposeModePhase;
  readonly approvalRequestId?: string;
  readonly preComposeMode?: ConversationMode;
  /** mode.changed 事件携带的新会话模式。Carried by the mode.changed event. */
  readonly mode?: ConversationMode;
}

export class NovelComposeOutputPayload extends OutputPayload {
  constructor(readonly options: NovelComposeOutputPayloadOptions) {
    super();
  }

  toObject(): JsonObject {
    return {
      composeVersion: 1,
      ...(this.options.designFilePath === undefined
        ? {}
        : { designFilePath: this.options.designFilePath }),
      ...(this.options.phase === undefined ? {} : { phase: this.options.phase }),
      ...(this.options.mode === undefined ? {} : { mode: this.options.mode }),
      ...(this.options.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: this.options.approvalRequestId }),
      ...(this.options.preComposeMode === undefined
        ? {}
        : { preComposeMode: this.options.preComposeMode }),
    };
  }
}

export interface NovelComposeOutputEventOptions extends OutputEventOptions {
  readonly eventName: NovelComposeEventName;
  readonly payload: NovelComposeOutputPayloadOptions;
}

/** 构造一个 novel.compose.* 事件。Builds one novel.compose.* event. */
export class NovelComposeOutputEvent extends NovelOutputEvent {
  readonly payload: NovelComposeOutputPayload;

  constructor(options: NovelComposeOutputEventOptions) {
    const payload = new NovelComposeOutputPayload(options.payload);
    super(options.eventName, payload, options);
    this.payload = payload;
  }
}
