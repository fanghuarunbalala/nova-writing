/** Normalized, query-adapter-neutral Story Outline tree view consumed by shared UI. */
export type StoryUnitPlanningStatus = "idea" | "outlined" | "ready";
export type StoryUnitRealizationStatus =
  | "pending"
  | "in-progress"
  | "completed"
  | "abandoned";

export type StoryOutlineReadScopeView =
  | { readonly kind: "canonical" }
  | { readonly kind: "draft"; readonly draftSessionId: string };

export interface StoryUnitScopeView {
  readonly code: string;
  readonly label: string;
}

export interface StoryUnitBlockStateView {
  readonly code: string;
  readonly label: string;
}

export interface StoryUnitAbandonmentView {
  readonly code: string;
  readonly label: string;
}

export interface StoryUnitProgressProjection {
  readonly completedLeafCount: number;
  readonly totalLeafCount: number;
}

export interface StoryUnitTreeNodeView {
  readonly id: string;
  readonly parentId?: string;
  readonly orderKey: string;
  readonly childIds: readonly string[];
  readonly title: string;
  readonly intent?: string;
  readonly synopsis?: string;
  readonly scope?: StoryUnitScopeView;
  readonly planningStatus: StoryUnitPlanningStatus;
  readonly realizationStatus: StoryUnitRealizationStatus;
  readonly blockState?: StoryUnitBlockStateView;
  readonly abandonment?: StoryUnitAbandonmentView;
  readonly progress: StoryUnitProgressProjection;
}

export interface StoryOutlineTreeView {
  readonly outlineId: string;
  readonly readScope: StoryOutlineReadScopeView;
  readonly sourceRevision: string;
  readonly rootIds: readonly string[];
  readonly nodes: Readonly<Record<string, StoryUnitTreeNodeView>>;
}

const PLANNING_STATUSES = new Set<StoryUnitPlanningStatus>([
  "idea",
  "outlined",
  "ready",
]);
const REALIZATION_STATUSES = new Set<StoryUnitRealizationStatus>([
  "pending",
  "in-progress",
  "completed",
  "abandoned",
]);

export function captureStoryOutlineTreeView(
  view: StoryOutlineTreeView,
): StoryOutlineTreeView {
  const rootIds = captureUniqueIds(view.rootIds, "Story Outline root ids");
  const nodeEntries = Object.entries(view.nodes);
  const nodes = new Map<string, StoryUnitTreeNodeView>();
  for (const [recordId, node] of nodeEntries) {
    const captured = captureStoryUnitTreeNode(node);
    if (recordId !== captured.id || nodes.has(captured.id)) {
      throw new TypeError("Story Outline node identity is inconsistent");
    }
    nodes.set(captured.id, captured);
  }
  validateTree(rootIds, nodes);
  return Object.freeze({
    outlineId: captureToken(view.outlineId, "Story Outline id"),
    readScope: captureReadScope(view.readScope),
    sourceRevision: captureToken(view.sourceRevision, "Story Outline revision"),
    rootIds,
    nodes: Object.freeze(Object.fromEntries(nodes)),
  });
}

function captureStoryUnitTreeNode(node: StoryUnitTreeNodeView): StoryUnitTreeNodeView {
  if (!PLANNING_STATUSES.has(node.planningStatus)) {
    throw new TypeError("StoryUnit planning status is invalid");
  }
  if (!REALIZATION_STATUSES.has(node.realizationStatus)) {
    throw new TypeError("StoryUnit realization status is invalid");
  }
  const completedLeafCount = captureCount(
    node.progress.completedLeafCount,
    "StoryUnit completed leaf count",
  );
  const totalLeafCount = captureCount(
    node.progress.totalLeafCount,
    "StoryUnit total leaf count",
  );
  if (completedLeafCount > totalLeafCount) {
    throw new TypeError("StoryUnit completed leaf count exceeds total");
  }
  return Object.freeze({
    id: captureToken(node.id, "StoryUnit id"),
    ...(node.parentId !== undefined
      ? { parentId: captureToken(node.parentId, "StoryUnit parent id") }
      : {}),
    orderKey: captureToken(node.orderKey, "StoryUnit order key"),
    childIds: captureUniqueIds(node.childIds, "StoryUnit child ids"),
    title: captureText(node.title, "StoryUnit title", 500),
    ...(node.intent !== undefined
      ? { intent: captureText(node.intent, "StoryUnit intent", 20_000) }
      : {}),
    ...(node.synopsis !== undefined
      ? { synopsis: captureText(node.synopsis, "StoryUnit synopsis", 40_000) }
      : {}),
    ...(node.scope !== undefined
      ? { scope: captureLabelView(node.scope, "StoryUnit scope") }
      : {}),
    planningStatus: node.planningStatus,
    realizationStatus: node.realizationStatus,
    ...(node.blockState !== undefined
      ? { blockState: captureLabelView(node.blockState, "StoryUnit block state") }
      : {}),
    ...(node.abandonment !== undefined
      ? { abandonment: captureLabelView(node.abandonment, "StoryUnit abandonment") }
      : {}),
    progress: Object.freeze({ completedLeafCount, totalLeafCount }),
  });
}

function validateTree(
  rootIds: readonly string[],
  nodes: ReadonlyMap<string, StoryUnitTreeNodeView>,
): void {
  const rootSet = new Set(rootIds);
  for (const rootId of rootIds) {
    const root = nodes.get(rootId);
    if (root === undefined || root.parentId !== undefined) {
      throw new TypeError("Story Outline root is invalid");
    }
  }
  const referencedChildren = new Set<string>();
  for (const node of nodes.values()) {
    if (node.parentId === node.id) throw new TypeError("StoryUnit cannot parent itself");
    if (node.parentId === undefined && !rootSet.has(node.id)) {
      throw new TypeError("Story Outline contains an unlisted root");
    }
    if (node.parentId !== undefined && !nodes.has(node.parentId)) {
      throw new TypeError("StoryUnit parent does not exist");
    }
    for (const childId of node.childIds) {
      const child = nodes.get(childId);
      if (child === undefined || child.parentId !== node.id) {
        throw new TypeError("StoryUnit child relationship is inconsistent");
      }
      if (referencedChildren.has(childId)) {
        throw new TypeError("StoryUnit is referenced by multiple parents");
      }
      referencedChildren.add(childId);
    }
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  const stack = rootIds
    .slice()
    .reverse()
    .map((id) => ({ id, leaving: false }));
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    if (frame.leaving) {
      active.delete(frame.id);
      visited.add(frame.id);
      continue;
    }
    if (active.has(frame.id)) throw new TypeError("Story Outline contains a cycle");
    if (visited.has(frame.id)) continue;
    const node = nodes.get(frame.id);
    if (node === undefined) throw new TypeError("Story Outline node does not exist");
    active.add(frame.id);
    stack.push({ id: frame.id, leaving: true });
    for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
      stack.push({ id: node.childIds[index], leaving: false });
    }
  }
  if (visited.size !== nodes.size) {
    throw new TypeError("Story Outline contains unreachable nodes");
  }
}

function captureReadScope(scope: StoryOutlineReadScopeView): StoryOutlineReadScopeView {
  if (scope?.kind === "canonical") return Object.freeze({ kind: "canonical" });
  if (scope?.kind === "draft") {
    return Object.freeze({
      kind: "draft",
      draftSessionId: captureToken(scope.draftSessionId, "Draft Session id"),
    });
  }
  throw new TypeError("Story Outline read scope is invalid");
}

function captureLabelView(
  value: { readonly code: string; readonly label: string },
  category: string,
) {
  return Object.freeze({
    code: captureToken(value.code, `${category} code`),
    label: captureText(value.label, `${category} label`, 500),
  });
}

function captureUniqueIds(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) throw new TypeError(`${label} are invalid`);
  const captured = values.map((value) => captureToken(value, label));
  if (new Set(captured).size !== captured.length) {
    throw new TypeError(`${label} must be unique`);
  }
  return Object.freeze(captured);
}

function captureCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function captureToken(value: string, label: string): string {
  return captureText(value, label, 200);
}

function captureText(value: string, label: string, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumLength ||
    /\u0000/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
