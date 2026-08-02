/** Immutable shared identity and lifecycle view for domain-specific Novel reviewers. */
export type NovelReviewDomain =
  | "outline"
  | "manuscript"
  | "character"
  | "location"
  | "publication";

export interface NovelChangeReviewTarget {
  readonly approvalRequestId: string;
  readonly novelId: string;
  readonly draftSessionId: string;
  readonly baseRevision: string;
  readonly changeSetDigest: `sha256:${string}`;
  readonly operationIds: readonly string[];
  readonly domain: NovelReviewDomain;
}

export type NovelChangeReviewLifecycle =
  | { readonly state: "loading" }
  | { readonly state: "ready" }
  | { readonly state: "pending-resolution" }
  | { readonly state: "resolved" }
  | { readonly state: "stale"; readonly code: string }
  | { readonly state: "conflict"; readonly code: string }
  | { readonly state: "unavailable"; readonly code: string }
  | { readonly state: "error"; readonly code: string; readonly retryable: boolean };

export interface NovelChangeReviewView {
  readonly target: NovelChangeReviewTarget;
  readonly title: string;
  readonly summary?: string;
  readonly lifecycle: NovelChangeReviewLifecycle;
}

const DOMAINS = new Set<NovelReviewDomain>([
  "outline",
  "manuscript",
  "character",
  "location",
  "publication",
]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export function captureNovelChangeReviewView(
  view: NovelChangeReviewView,
): NovelChangeReviewView {
  const operationIds = view.target.operationIds.map((operationId) =>
    captureToken(operationId, "Review Operation id"),
  );
  if (new Set(operationIds).size !== operationIds.length) {
    throw new TypeError("Review Operation ids must be unique");
  }
  if (!DOMAINS.has(view.target.domain)) {
    throw new TypeError("Novel Review domain is invalid");
  }
  if (!DIGEST_PATTERN.test(view.target.changeSetDigest)) {
    throw new TypeError("Novel Review ChangeSet digest is invalid");
  }
  return Object.freeze({
    target: Object.freeze({
      approvalRequestId: captureToken(
        view.target.approvalRequestId,
        "Review Approval Request id",
      ),
      novelId: captureToken(view.target.novelId, "Review Novel id"),
      draftSessionId: captureToken(
        view.target.draftSessionId,
        "Review Draft Session id",
      ),
      baseRevision: captureToken(
        view.target.baseRevision,
        "Review base revision",
      ),
      changeSetDigest: view.target.changeSetDigest,
      operationIds: Object.freeze(operationIds),
      domain: view.target.domain,
    }),
    title: captureText(view.title, "Novel Review title", 500),
    ...(view.summary !== undefined
      ? { summary: captureText(view.summary, "Novel Review summary", 2_000) }
      : {}),
    lifecycle: captureLifecycle(view.lifecycle),
  });
}

function captureLifecycle(
  lifecycle: NovelChangeReviewLifecycle,
): NovelChangeReviewLifecycle {
  switch (lifecycle.state) {
    case "loading":
    case "ready":
    case "pending-resolution":
    case "resolved":
      return Object.freeze({ state: lifecycle.state });
    case "stale":
    case "conflict":
    case "unavailable":
      return Object.freeze({
        state: lifecycle.state,
        code: captureToken(lifecycle.code, "Novel Review lifecycle code"),
      });
    case "error":
      return Object.freeze({
        state: lifecycle.state,
        code: captureToken(lifecycle.code, "Novel Review error code"),
        retryable: lifecycle.retryable,
      });
  }
}

function captureToken(value: string, label: string): string {
  return captureText(value, label, 200);
}

function captureText(value: string, label: string, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
