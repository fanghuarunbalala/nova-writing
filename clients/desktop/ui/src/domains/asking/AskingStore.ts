/**
 * AskingStore
 *
 * 提问数据源（shell 级 ExternalStore）：数据唯一权威是 CMS wait 队列的 asking 条目。
 * refresh() 经 api.askings.list() 拉取；resolve() 经 api.askings.resolve() 提交
 * （CMS 记录并直推驻留 conversation，解除 AskUserQuestion 工具的挂起等待）。
 * 变化通知经 askingChangeBus 触发重拉（拉取为准，推送仅作触发）。
 */
import type { AskQuestionAnswer, AskingQueueItem, NovelApiClient } from "@novel/core";
import { ExternalStore } from "../../shared/state/ExternalStore.js";

export interface AskingStoreSnapshot {
  readonly askings: readonly AskingQueueItem[];
  readonly pendingCount: number;
}

const EMPTY: AskingStoreSnapshot = Object.freeze({
  askings: Object.freeze([]),
  pendingCount: 0,
});

export class AskingStore extends ExternalStore<AskingStoreSnapshot> {
  private readonly api: NovelApiClient;

  /**
   * @param deps api（askings.list/resolve）
   */
  constructor(deps: { readonly api: NovelApiClient }) {
    super(EMPTY);
    this.api = deps.api;
  }

  /** 从 CMS 拉取提问队列（变化通知触发） */
  async refresh(): Promise<void> {
    try {
      const askings = await this.api.askings.list();
      const pendingCount = askings.filter((item) => item.status === "pending").length;
      this.setSnapshot({
        askings: Object.freeze(askings),
        pendingCount,
      });
    } catch {
      // 拉取失败保持现状（卡片显示旧数据，下次通知重试）
    }
  }

  /**
   * 提交作者回答（CMS 记录 + 直推 conversation；随后重拉刷新）
   * @param requestId 提问请求 id
   * @param answers 逐问回答（skipped 表示作者跳过）
   */
  resolve(requestId: string, answers: readonly AskQuestionAnswer[]): Promise<boolean> {
    return this.api.askings.resolve(requestId, answers).then((hit) => {
      if (hit) void this.refresh();
      return hit;
    });
  }
}
