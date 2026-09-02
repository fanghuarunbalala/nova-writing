/**
 * InspectorRouter
 *
 * 右侧 inspector 状态机：关闭 / 内容目录 / 实体 / 对话 / 大纲单元，
 * 模式 closed | normal | wide（wide 由卡片 inspectorSize 触发）。
 * directory = 对话视图默认态（内容目录：大纲/人物/地点，demo 方案 A v0.8）；
 * 审批已弹窗化：审批交互走 ApprovalModal，不走 inspector。
 */
import { ExternalStore } from "../state/ExternalStore.js";

export type InspectorState =
  | { readonly kind: "closed" }
  | { readonly kind: "directory" }
  | { readonly kind: "entity"; readonly entityType: "character" | "location"; readonly entityId: string }
  | { readonly kind: "conversation"; readonly conversationId: string }
  | { readonly kind: "outlineUnit"; readonly unitId: string };

export type InspectorMode = "closed" | "normal" | "wide";

export interface InspectorSnapshot {
  readonly state: InspectorState;
  readonly mode: InspectorMode;
}

export class InspectorRouter extends ExternalStore<InspectorSnapshot> {
  constructor() {
    super({ state: { kind: "closed" }, mode: "closed" });
  }

  transition(state: InspectorState, mode: InspectorMode = "normal"): void {
    this.setSnapshot({ state, mode });
  }

  close(): void {
    this.setSnapshot({ state: { kind: "closed" }, mode: "closed" });
  }

  setMode(mode: InspectorMode): void {
    if (this.snapshot.state.kind === "closed" && mode !== "closed") return;
    this.setSnapshot({ ...this.snapshot, mode });
  }
}
