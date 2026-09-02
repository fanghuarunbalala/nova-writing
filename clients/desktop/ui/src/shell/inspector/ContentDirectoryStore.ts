/**
 * ContentDirectoryStore
 *
 * 右栏内容目录状态（列表 tab / 下钻详情页 / 实体定位）。
 * v0.10：点击最细粒度行整栏切换详情页（unit/chapter/character/location），
 * back() 返回列表（tab 保留为返回上下文）；locate(detail) 五类直达详情页
 * （paragraph 引用定位 = 章详情页 + 段落闪烁目标）+ nonce 驱动滚动高亮。
 */
import { ExternalStore } from "../../shared/state/ExternalStore.js";

export type ContentDirectoryTab = "outline" | "manuscript" | "characters" | "locations";

export type DirectoryEntityKind = "character" | "location";

/** 下钻详情页目标（unit = 大纲单元；character/location = 档案页） */
export interface DirectoryDetail {
  readonly kind: "unit" | "chapter" | DirectoryEntityKind;
  readonly id: string;
  /** 章详情页内闪烁定位的段落（paragraph 引用定位用） */
  readonly paragraphId?: string;
}

export interface ContentDirectorySnapshot {
  readonly tab: ContentDirectoryTab;
  /** 下钻详情页；undefined = 列表态 */
  readonly detail: DirectoryDetail | undefined;
  /** locate 目标（含 nonce：同一目标重复点击也触发滚动高亮） */
  readonly locate:
    | { readonly detail: DirectoryDetail; readonly nonce: number }
    | undefined;
}

const INITIAL: ContentDirectorySnapshot = Object.freeze({
  tab: "outline",
  detail: undefined,
  locate: undefined,
});

const TAB_BY_DETAIL: Record<DirectoryDetail["kind"], ContentDirectoryTab> = {
  unit: "outline",
  chapter: "manuscript",
  character: "characters",
  location: "locations",
};

export class ContentDirectoryStore extends ExternalStore<ContentDirectorySnapshot> {
  constructor() {
    super(INITIAL);
  }

  /** 切 tab：回到列表态（详情页不跨 tab 保留） */
  setTab(tab: ContentDirectoryTab): void {
    this.setSnapshot({ ...this.snapshot, tab, detail: undefined });
  }

  /** 进入下钻详情页（行点击 / 面板内互跳） */
  openDetail(detail: DirectoryDetail): void {
    if (sameDetail(this.snapshot.detail, detail)) return;
    this.setSnapshot({ ...this.snapshot, detail });
  }

  /** 详情页返回列表 */
  back(): void {
    if (this.snapshot.detail === undefined) return;
    this.setSnapshot({ ...this.snapshot, detail: undefined });
  }

  /** 实体标签/引用 chip 点击定位：切 tab + 直达详情页 + nonce 触发滚动高亮 */
  locate(detail: DirectoryDetail): void {
    const locate = { detail, nonce: (this.snapshot.locate?.nonce ?? 0) + 1 };
    this.setSnapshot({ ...this.snapshot, tab: TAB_BY_DETAIL[detail.kind], detail, locate });
  }
}

function sameDetail(
  left: DirectoryDetail | undefined,
  right: DirectoryDetail,
): boolean {
  return (
    left !== undefined &&
    left.kind === right.kind &&
    left.id === right.id &&
    left.paragraphId === right.paragraphId
  );
}
