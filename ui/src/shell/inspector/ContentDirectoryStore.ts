/**
 * ContentDirectoryStore
 *
 * 右栏内容目录状态（tab / 手风琴展开项 / 实体定位）。
 * locate(kind,id)：对话流实体标签点击 → 切 tab + 展开详情卡 + nonce 驱动滚动高亮。
 */
import { ExternalStore } from "../../shared/state/ExternalStore.js";

export type ContentDirectoryTab = "outline" | "characters" | "locations";

export type DirectoryEntityKind = "character" | "location";

export interface ContentDirectorySnapshot {
  readonly tab: ContentDirectoryTab;
  /** 手风琴单开：当前展开详情卡的实体（`${kind}:${id}`）；undefined = 全收起 */
  readonly expandedKey: string | undefined;
  /** locate 目标（含 nonce：同一目标重复点击也触发滚动高亮） */
  readonly locate:
    | { readonly kind: DirectoryEntityKind; readonly id: string; readonly nonce: number }
    | undefined;
}

const INITIAL: ContentDirectorySnapshot = Object.freeze({
  tab: "outline",
  expandedKey: undefined,
  locate: undefined,
});

const TAB_BY_KIND: Record<DirectoryEntityKind, ContentDirectoryTab> = {
  character: "characters",
  location: "locations",
};

export class ContentDirectoryStore extends ExternalStore<ContentDirectorySnapshot> {
  constructor() {
    super(INITIAL);
  }

  setTab(tab: ContentDirectoryTab): void {
    this.setSnapshot({ ...this.snapshot, tab });
  }

  /** 行点击：手风琴单开（展开新项收起旧项；再点当前项收起） */
  toggleExpand(key: string): void {
    this.setSnapshot({
      ...this.snapshot,
      expandedKey: this.snapshot.expandedKey === key ? undefined : key,
    });
  }

  /** 实体标签点击定位：切 tab + 展开详情卡 + nonce 触发滚动高亮 */
  locate(kind: DirectoryEntityKind, id: string): void {
    const locate = { kind, id, nonce: (this.snapshot.locate?.nonce ?? 0) + 1 };
    this.setSnapshot({
      ...this.snapshot,
      tab: TAB_BY_KIND[kind],
      expandedKey: `${kind}:${id}`,
      locate,
    });
  }
}
