# Novel Agent Tool Surface (Working Draft)

## 1. Status

Working draft for the deferred "Agent-facing Novel Tools" item
(`docs/novel-domain.md` Open Question 13; `docs/novel-implementation-plan.md`
Task N11-D deferral). Confirmed **group by group** with the user.

**Confirmed and implemented: the outline group** — `NovelOutlineRead`,
`NovelOutlineWrite`, `NovelOutlineEdit` (see `core/src/tools/novel/outline/`,
validation: `core/scripts/novel-outline-tools-smoke.mjs`).

**Pending:** characters, locations, manuscript (including publication and
paragraph structure), unified delete, and draft lifecycle. Each pending group
will be confirmed and re-derived using the conventions in Section 2; the
earlier 16-tool draft is superseded and the total will be recounted as groups
are confirmed.

**Removed:** `NovelCompletionEvaluate`. Realization, conformance, and admission
are internal host concerns and are hidden from the agent surface.

## 2. Design Conventions (confirmed)

1. **Explicit read scope.** Reads take `scope: "canonical" | "draft"`.
2. **No optimistic-lock digests at the tool surface.** Draft writes are
   serialized per conversation; digest/version preconditions remain inside core
   and are resolved by the trusted host internally. Revisit only for parallel
   subagent shared-Draft scenarios.
3. **Draft-only writes.** Every mutation appends to the caller's Draft journal;
   nothing becomes authoritative until `NovelDraftCommit`.
4. **Outline identity is implicit.** The host auto-creates the outline when the
   first `story_unit` is written. Agents never manage outline identity.
5. **orderKey is agent-visible.** It is an opaque sort key: fixed-width
   uppercase hexadecimal digit groups (for example `8000`, `4000`,
   `40008000`), the final group must not be `0000`, and native string
   comparison is the authoritative order. An omitted `orderKey` appends after
   the last sibling.
6. **New story unit defaults.** `planningStatus=idea`,
   `realizationStatus=pending`, `parentId=root`, `orderKey=append`.
7. **Batch writes.** Write/Edit take arrays, applied in order; a failed item
   stops the batch; earlier items remain applied; per-item results are
   returned.
8. **Write vs Edit.** `Write` creates (target must not exist); `Edit` performs
   field-level partial overwrite (PATCH): provided fields overwrite, omitted
   fields are untouched, and an explicit `null` clears an optional field or
   array. `leaf` follows the same rule, and `leaf: null` clears the whole plan.
9. **Hidden internal types.** StoryUnitRealization, conformance/admission,
   ChangeSet, conflicts, projections, operation IDs, digests, OrderKey
   generation internals, and revision formats never appear in tool parameters
   or results.
10. **Completion.** Agents declare completion by setting
    `realizationStatus=completed` through `Edit`; authoritative admission is
    validated host-side.
11. **Provider-neutral host boundary.** Tools depend only on the trusted-host
    facade; no SQLite paths, stores, or Node adapters appear in tool arguments.
12. **Log redaction.** Structured logs record identities and counts only.

## 3. Tool Groups (current)

```yaml
# novel.outline (confirmed)
schemaVersion: 1
id: novel.outline
version: 1.0.0
label: Novel Outline
tools: [NovelOutlineRead, NovelOutlineWrite, NovelOutlineEdit]
```

Pending groups (to be confirmed): `novel.entities` (characters, locations),
`novel.manuscript` (manuscript, publication, blocks), `novel.delete`,
`novel.draft`.

## 4. Shared Value Contracts

```ts
type Scope = "canonical" | "draft";

// Full value used by NovelOutlineWrite (create). All optional fields default.
interface StoryUnitWrite {
  id?: string;                                   // optional; host generates when omitted
  title: string;                                 // required
  intent?: string;
  synopsis?: string;
  scope?: "saga" | "arc" | "sequence" | "scene" | "custom";
  planningStatus?: "idea" | "outlined" | "ready";           // default idea
  realizationStatus?: "pending" | "in-progress" | "completed" | "abandoned"; // default pending
  parentId?: string;                             // default root
  orderKey?: string;                             // default append after last sibling
  blockState?: {
    reasonCode?: string;
    note?: string;
    dependencyIds: string[];
    blockedAt: string;
  };
  abandonment?: {
    reasonCode?: string;
    note?: string;
    replacementStoryUnitId?: string;
    abandonedAt: string;
  };
  leaf?: LeafPlanWrite;                          // optional; leaf units only
}

// Embedded in StoryUnitWrite. storyUnitId fields are filled by the host.
interface LeafPlanWrite {
  settingMode: "located" | "location-independent";  // required
  time?: { description: string; timelineOrderKey?: string };
  characters: Array<{
    characterId: string;
    involvement?: { presence: "present" | "offstage" | "mentioned"; roles: string[] };
    note?: string;
  }>;
  locations: Array<{
    locationId: string;
    involvement?: { role: "primary" | "secondary" | "mentioned"; affected: boolean };
    note?: string;
  }>;
  events: Array<{ id: string; orderKey: string; description: string }>;
  rhythmBeats: Array<{
    id: string;
    orderKey: string;
    rhythm: "setup" | "rise" | "hold" | "turn" | "climax" | "fall" | "release" | "aftermath";
    intensity: 1 | 2 | 3 | 4 | 5;
    readerEmotion?: string;
    pointOfViewEmotion?: string;
    description?: string;
    relatedEventIds: string[];
  }>;
  entityChanges: Array<{
    id: string;
    entityType: "character" | "location";
    entityId: string;
    relatedEntityId?: string;
    category: "identity" | "condition" | "location" | "relationship" | "knowledge"
      | "goal" | "ownership" | "environment" | "custom";
    summary: string;
    sourceEventIds: string[];
  }>;
}

// Per-item result for batch Write/Edit.
interface OutlineWriteResultItem {
  id: string;
  status: "appended" | "duplicate" | "rejected";
  sequence?: number;   // appended items
  reason?: string;     // rejected items; stable codes such as
                       // unknown_parent / duplicate_id / not_leaf / invalid_order_key
}
```

### 5.4 NovelCharacterRead / Write / Edit (confirmed, implemented)

- `NovelCharacterRead` reads Character profiles for one explicit scope;
  `characterId` omitted lists all. `entityVersion` stays inside the host.
- `NovelCharacterWrite` batch-creates profiles. `id` is optional; the host
  generates and returns it (a provided id is used and must be unique).
- `NovelCharacterEdit` batch field-level PATCH. `id` is required. Provided
  fields overwrite, omitted fields stay, `null` clears `summary` /
  `initialState` / `authorNotes`, and `aliases` replaces the whole array when
  provided (`[]` clears it). `name` cannot be cleared.
- Group: `novel.entities`. Deletion is handled by the unified delete tool.

## 5. Confirmed: Outline Tools

### 5.1 NovelOutlineRead

- Version: `1.0.0`
- Group: `novel.outline`
- Label: 读取大纲
- Prompt snippet: `读取大纲树（单元、计划与进度）`
- Description: Reads the outline tree. StoryUnit nodes are ordered by an
  opaque `orderKey`; `planningStatus` (idea/outlined/ready) and
  `realizationStatus` (pending/in-progress/completed/abandoned) are independent.
  `storyUnitId` omitted returns the whole tree; `includePlans` attaches leaf
  plans.
- Core mapping: `outlineQueries.getTree / getStoryUnit / getLeafStoryUnitPlan`

```ts
interface Params {
  scope: Scope;
  storyUnitId?: string;
  includePlans?: boolean;   // default false
}

interface Result {
  outline: { id: string; novelId: string };
  units: Array<{
    unit: StoryUnitWrite & { outlineId: string };  // tool-visible unit state
    plan?: LeafPlanToolValue;                       // present when includePlans=true
    progress?: {
      effectiveStatus: string;
      isBlocked: boolean;
      completedLeafCount: number;
      totalLeafCount: number;
    };
  }>;
}
```

### 5.2 NovelOutlineWrite

- Version: `1.0.0`
- Group: `novel.outline`
- Label: 新建大纲单元
- Prompt snippet: `批量在草稿中新建大纲单元（可携带叶子计划）`
- Description: Batch-creates story units in the caller's Draft. Targets must
  not exist. The outline identity is auto-created by the host. New units use
  the defaults in Section 2; `leaf` may be attached to leaf units only.
  Applied in order; a failed item stops the batch.
- Core mapping: `outline.createStoryUnit`, plus plan creation via
  `outline.replaceLeafStoryUnitPlan` when `leaf` is present

```ts
interface Params {
  values: StoryUnitWrite[];
}

interface Result {
  items: OutlineWriteResultItem[];
}
```

### 5.3 NovelOutlineEdit

- Version: `1.0.0`
- Group: `novel.outline`
- Label: 修改大纲单元
- Prompt snippet: `批量局部修改大纲单元与叶子计划`
- Description: Batch field-level partial overwrite (PATCH) of existing story
  units. Provided fields overwrite; omitted fields stay; `null` clears an
  optional field or array. `leaf` is updated with the same partial rule and
  `leaf: null` clears the whole plan. `parentId: null` moves the unit to the
  root; a provided `orderKey` reorders the unit. Moving is expressed as an
  Edit of `parentId`/`orderKey`; there is no separate move tool.
- Core mapping: host reads current state, merges the patch, then invokes
  `outline.replaceStoryUnit`, `outline.moveStoryUnit`, and
  `outline.replaceLeafStoryUnitPlan` / `clearLeafStoryUnitPlan` as needed

```ts
interface Params {
  values: Array<{
    id: string;
    value: Partial<StoryUnitWrite> & {
      title?: string;
      intent?: string | null;
      synopsis?: string | null;
      scope?: StoryUnitWrite["scope"] | null;
      planningStatus?: StoryUnitWrite["planningStatus"];
      realizationStatus?: StoryUnitWrite["realizationStatus"];
      parentId?: string | null;        // null = move to root
      orderKey?: string;
      blockState?: StoryUnitWrite["blockState"] | null;    // null = unblock
      abandonment?: StoryUnitWrite["abandonment"] | null;  // null = restore
      leaf?: Partial<LeafPlanWrite> | null;                // null = clear plan
    };
  }>;
}

interface Result {
  items: OutlineWriteResultItem[];
}
```

## 6. Pending Groups

The following groups will be confirmed next, following the same conventions
(batch, PATCH, hidden types, no tool-surface digests):

- characters / locations
- manuscript (body text), publication (volumes/chapters), paragraphs (block
  structure)
- unified delete
- draft lifecycle (`NovelDraft`, `NovelDraftRollback`, `NovelDraftCommit`,
  `NovelDraftRebase`)

## 7. Resolved Decisions

- `NovelCompletionEvaluate` removed; completion is declared via
  `realizationStatus` and validated host-side.
- No `expectedDigest` at the tool surface; optimistic locking is deferred.
- Outline identity is auto-created; `target: "outline"` removed.
- `orderKey` is managed by the agent (opaque string; append by default).
- Write/Edit are batch and split by intent: create vs field-level patch.
- `leaf` is embedded in the story unit value; `leaf: null` clears the plan, so
  the unified delete does not need a `leaf_plan` target.
- Moving a story unit is an Edit of `parentId`/`orderKey`; no separate move
  tool.
