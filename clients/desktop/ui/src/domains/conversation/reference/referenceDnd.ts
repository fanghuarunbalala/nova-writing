/**
 * referenceDnd
 *
 * 实体拖入输入框作引用（PRD F5）：HTML5 DnD 载荷约定。
 * 拖拽源（目录行/段落行）在 dragstart 写入自定义 MIME（JSON {kind,id,label}），
 * composer 为落点（dragOver 高亮 → drop 解析入引用栏）。
 * 只写自定义 MIME 不写 text/plain——避免原生 textarea drop 再插一遍文字。
 */
import { debugLog } from "@novel/core/client";
import type { ComposerReference, ComposerReferenceKind } from "../store/ComposerDraftStore.js";

export const REFERENCE_DND_MIME = "application/x-novel-ref";

const REFERENCE_KINDS: readonly ComposerReferenceKind[] = [
  "character",
  "location",
  "outline",
  "chapter",
  "paragraph",
];

interface DragEventLike {
  readonly dataTransfer: DataTransfer | null;
}

/** 拖拽源：写入载荷 + copy 语义。 */
export function setReferenceDragPayload(
  event: DragEventLike,
  reference: ComposerReference,
): void {
  const dt = event.dataTransfer;
  if (dt === null) return;
  dt.setData(REFERENCE_DND_MIME, JSON.stringify(reference));
  dt.effectAllowed = "copy";
  debugLog("[refs] dragstart:", { mime: REFERENCE_DND_MIME, ...reference });
}

/** 落点 dragover 判定：事件携带引用载荷才允许放置（preventDefault 前置）。 */
export function hasReferenceDragPayload(event: DragEventLike): boolean {
  const dt = event.dataTransfer;
  if (dt === null) return false;
  return dt.types.includes(REFERENCE_DND_MIME);
}

/** 落点 drop：解析载荷；非法/损坏载荷返回 undefined（调用方忽略）。 */
export function readReferenceDragPayload(
  event: DragEventLike,
): ComposerReference | undefined {
  const dt = event.dataTransfer;
  if (dt === null || !dt.types.includes(REFERENCE_DND_MIME)) {
    debugLog("[refs] drop parse failed: 无引用 MIME", {
      expected: REFERENCE_DND_MIME,
      types: dt === null ? null : [...dt.types],
    });
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(dt.getData(REFERENCE_DND_MIME));
  } catch {
    debugLog("[refs] drop parse failed: JSON 损坏", {
      raw: dt.getData(REFERENCE_DND_MIME).slice(0, 120),
    });
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") {
    debugLog("[refs] drop parse failed: 载荷非对象", { parsed });
    return undefined;
  }
  const raw = parsed as { kind?: unknown; id?: unknown; label?: unknown };
  if (
    typeof raw.kind !== "string" ||
    !REFERENCE_KINDS.includes(raw.kind as ComposerReferenceKind) ||
    typeof raw.id !== "string" ||
    raw.id.trim() === ""
  ) {
    debugLog("[refs] drop parse failed: 字段非法", { raw });
    return undefined;
  }
  const label = typeof raw.label === "string" && raw.label.trim() !== "" ? raw.label : raw.id;
  const reference = Object.freeze({ kind: raw.kind as ComposerReferenceKind, id: raw.id, label });
  debugLog("[refs] drop parsed:", { ...reference });
  return reference;
}
