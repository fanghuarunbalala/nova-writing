/** Shared read-only review chrome around domain-specific diff content. */
import type { ReactNode } from "react";
import {
  ReferenceInConversationButton,
  type ComposerContentReference,
} from "../composer/index.js";
import {
  captureNovelChangeReviewView,
  type NovelChangeReviewLifecycle,
  type NovelChangeReviewView,
  type NovelReviewDomain,
} from "./NovelChangeReviewView.js";

export interface NovelChangeReviewShellProps {
  readonly view: NovelChangeReviewView;
  readonly referenceForOperation?: (
    operationId: string,
    view: NovelChangeReviewView,
  ) => ComposerContentReference | undefined;
  readonly children?: ReactNode;
}

const DOMAIN_LABELS: Readonly<Record<NovelReviewDomain, string>> = Object.freeze({
  outline: "大纲审阅",
  manuscript: "正文审阅",
  character: "人物审阅",
  location: "地点审阅",
  publication: "发布审阅",
});

export function NovelChangeReviewShell({
  view: input,
  referenceForOperation,
  children,
}: NovelChangeReviewShellProps) {
  const view = captureNovelChangeReviewView(input);
  const operationReferences = referenceForOperation === undefined
    ? []
    : view.target.operationIds.flatMap((operationId) => {
        const reference = referenceForOperation(operationId, view);
        return reference === undefined ? [] : [{ operationId, reference }];
      });
  return (
    <section
      className="novel-change-review"
      data-review-domain={view.target.domain}
      data-review-state={view.lifecycle.state}
      aria-busy={view.lifecycle.state === "loading"}
    >
      <header className="novel-change-review-header">
        <div>
          <span>{DOMAIN_LABELS[view.target.domain]}</span>
          <h2>{view.title}</h2>
          {view.summary !== undefined ? <p>{view.summary}</p> : null}
        </div>
        <ReviewLifecycleBadge lifecycle={view.lifecycle} />
      </header>
      <dl className="novel-change-review-identity" aria-label="审阅绑定身份">
        <div>
          <dt>基础版本</dt>
          <dd>{view.target.baseRevision}</dd>
        </div>
        <div>
          <dt>变更摘要</dt>
          <dd>{abbreviateDigest(view.target.changeSetDigest)}</dd>
        </div>
        <div>
          <dt>操作数量</dt>
          <dd>{view.target.operationIds.length}</dd>
        </div>
      </dl>
      <ReviewLifecycleNotice lifecycle={view.lifecycle} />
      {operationReferences.length > 0 ? (
        <section className="novel-change-review-operations" aria-label="可引用的变更操作">
          <h3>变更操作</h3>
          <ul>
            {operationReferences.map(({ operationId, reference }) => (
              <li key={operationId}>
                <span>{reference.label}</span>
                <ReferenceInConversationButton reference={reference} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="novel-change-review-content">{children}</div>
      <footer className="novel-change-review-footer">
        审阅操作保持只读；决策必须通过 Conversation InputEvent 提交。
      </footer>
    </section>
  );
}

function ReviewLifecycleBadge({
  lifecycle,
}: {
  readonly lifecycle: NovelChangeReviewLifecycle;
}) {
  const labels: Readonly<Record<NovelChangeReviewLifecycle["state"], string>> = {
    loading: "载入中",
    ready: "待审阅",
    "pending-resolution": "等待处理",
    resolved: "已处理",
    stale: "已过期",
    conflict: "有冲突",
    unavailable: "不可用",
    error: "载入失败",
  };
  return (
    <span className="novel-change-review-state" data-state={lifecycle.state}>
      {labels[lifecycle.state]}
    </span>
  );
}

function ReviewLifecycleNotice({
  lifecycle,
}: {
  readonly lifecycle: NovelChangeReviewLifecycle;
}) {
  if (lifecycle.state === "loading") {
    return <p className="novel-change-review-notice">正在载入审阅内容。</p>;
  }
  if (lifecycle.state === "pending-resolution") {
    return <p className="novel-change-review-notice">决策已记录，等待持久化结果事件。</p>;
  }
  if (lifecycle.state === "resolved") {
    return <p className="novel-change-review-notice">该审阅已经处理。</p>;
  }
  if (
    lifecycle.state === "stale" ||
    lifecycle.state === "conflict" ||
    lifecycle.state === "unavailable" ||
    lifecycle.state === "error"
  ) {
    return (
      <p className="novel-change-review-notice" data-notice-kind={lifecycle.state} role="status">
        {lifecycleMessage(lifecycle.state)}（{lifecycle.code}）
      </p>
    );
  }
  return null;
}

function lifecycleMessage(
  state: "stale" | "conflict" | "unavailable" | "error",
): string {
  switch (state) {
    case "stale":
      return "审阅绑定已过期，请刷新后重新确认";
    case "conflict":
      return "当前变更与其他修改存在冲突";
    case "unavailable":
      return "当前审阅内容不可用";
    case "error":
      return "审阅内容载入失败";
  }
}

function abbreviateDigest(digest: string): string {
  return `${digest.slice(0, 15)}…${digest.slice(-8)}`;
}
