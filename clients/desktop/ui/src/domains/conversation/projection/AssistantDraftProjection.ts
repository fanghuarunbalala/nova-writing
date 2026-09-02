/**
 * AssistantDraftProjection
 *
 * 助手消息流式草稿投影：按序累积 deltas，terminal 为流式完成时的最终文本。
 * phase ∈ streaming / completed / failed / cancelled。
 */
export interface AssistantDraftProjection {
  readonly sequence: number;
  readonly deltas: readonly string[];
  readonly terminal: string | undefined;
  readonly phase: "streaming" | "completed" | "failed" | "cancelled";
}

export function createAssistantDraftProjection(sequence: number): AssistantDraftProjection {
  return {
    sequence,
    deltas: Object.freeze([]),
    terminal: undefined,
    phase: "streaming",
  };
}

export function appendAssistantDraftDelta(
  projection: AssistantDraftProjection,
  delta: string,
): AssistantDraftProjection {
  if (projection.phase !== "streaming" || projection.terminal !== undefined) {
    throw new TypeError("Cannot append a delta to a terminal draft");
  }
  return {
    ...projection,
    deltas: Object.freeze([...projection.deltas, delta]),
  };
}

export function completeAssistantDraft(
  projection: AssistantDraftProjection,
  terminal: string,
): AssistantDraftProjection {
  return { ...projection, terminal, phase: "completed" };
}

export function failAssistantDraft(
  projection: AssistantDraftProjection,
): AssistantDraftProjection {
  return { ...projection, phase: "failed" };
}

export function cancelAssistantDraft(
  projection: AssistantDraftProjection,
): AssistantDraftProjection {
  return { ...projection, phase: "cancelled" };
}

/** 当前可见文本：流式期间取 deltas 拼接，完成后取 terminal。 */
export function assistantDraftText(projection: AssistantDraftProjection): string {
  return projection.terminal ?? projection.deltas.join("");
}
