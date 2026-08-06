/**
 * useManuscriptBlock
 *
 * 从结构快照中按 blockId 取块（blockId 实际是 ParagraphId）。正文全文的懒加载
 * （api.novel.paragraphs.get）由 Phase 3 详情 inspector 接入；此处只读快照摘要。
 */
import { useMemo } from "react";
import { useExternalStore } from "../../../../shared/state/useExternalStore.js";
import type { ManuscriptStructureStore } from "../store/ManuscriptStructureStore.js";

export function useManuscriptBlock(
  store: ManuscriptStructureStore,
  blockId: string | undefined,
) {
  const snapshot = useExternalStore(store);
  return useMemo(() => {
    if (blockId === undefined) return undefined;
    for (const chapter of snapshot.chapters) {
      const block = chapter.blocks.find((item) => item.blockId === blockId);
      if (block !== undefined) return block;
    }
    return undefined;
  }, [blockId, snapshot.chapters]);
}
