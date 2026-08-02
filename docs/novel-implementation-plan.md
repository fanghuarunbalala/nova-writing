# Novel Layer Implementation Plan

## 1. Document Status

This document is the authoritative implementation plan for the Novel layer as of August 2, 2026.

- The current active repository track is Novel Task N0 through Task N11.
- Runtime Task 1 through Task 7 remains documented in `docs/implementation-plan.md` but is paused while the Novel track is active.
- Novel implementation must preserve the accepted domain and architecture boundaries in `docs/novel-domain.md`.
- Agent-facing Novel Tools, Tool YAML, Prompt composition, Agent definitions, and CLI/GUI/Web Novel interfaces are outside this plan.
- Each completed Novel step must be validated and committed independently before the next step begins.

## 2. Autonomous Execution Agreement

The repository protocol in `AGENTS.md` remains authoritative. During the active Novel track the agent may autonomously plan, implement, validate, document, and commit the next incomplete Novel step without waiting for approval.

The mandatory cycle is:

```text
Read AGENTS.md and the active Novel task
    ↓
Read docs/novel-domain.md and relevant existing code
    ↓
Publish one concrete step plan
    ↓
Implement only that step
    ↓
Run focused validation
    ↓
Run pnpm check and all established Core smoke scripts
    ↓
Review scope, generated files, secrets, and formatting
    ↓
Commit the step immediately
    ↓
Publish the next step plan and continue
```

Autonomous authority does not permit the agent to:

- implement Agent-facing Novel Tools or Tool YAML
- reopen unrelated Runtime checkpoints
- silently choose a decision explicitly marked unresolved when implementation cannot proceed safely without it
- combine multiple Novel task boundaries into one commit
- expose SQLite, Node, Pi, process placement, filesystem paths, or future Rust details through platform-neutral Novel contracts

## 3. Accepted Technical Boundary

```mermaid
flowchart TD
    Upper["Conversation / Runtime / future Tool adapters"]
    Application["Novel Application Services"]
    Domain["Novel Models, Operations, Validation"]
    Ports["Novel Storage and Integration Ports"]
    Node["Node SQLite / Filesystem Adapters"]
    Output["Conversation OutputEvent Publisher"]

    Upper --> Application
    Application --> Domain
    Application --> Ports
    Node -. implements .-> Ports
    Application --> Output
```

The implementation follows these rules:

- one Workspace corresponds to one Novel
- `runtime.sqlite` and `novel.sqlite` remain separate
- each top-level Conversation may own one active Draft Session
- multiple Conversations may own independent Drafts concurrently
- each Draft owns one durable `draft.sqlite`
- each Draft has one serialized Draft Writer
- each Novel has one serialized canonical Commit Writer
- Draft operations use short SQLite transactions
- canonical Commit uses one short SQLite transaction
- Draft state never replaces the canonical SQLite file directly
- Domain Operations are the deterministic Commit and Rebase contract
- the canonical database is the authority for accepted Novel state, Commit existence, and NovelRevision
- external Commit payload files are auxiliary immutable history, not Commit authority
- all public Novel application and port methods are asynchronous
- a Node adapter may use synchronous SQLite internally behind a serialized asynchronous boundary

## 4. Explicitly Deferred Types

The following contracts are not invented during foundation tasks:

```text
StoryTimeDescription
ManuscriptAnchor
ManuscriptRange
StoryUnitBlockState
StoryUnitAbandonment
OrderKey
```

Their implementation gates are:

- `OrderKey`, `StoryUnitBlockState`, `StoryUnitAbandonment`, and `StoryTimeDescription` must be resolved before the affected Task N9 outline steps.
- `ManuscriptAnchor` and `ManuscriptRange` must be resolved before the affected Task N10 manuscript steps.
- Earlier tasks must not add placeholder public contracts that silently predetermine these decisions.

## 5. Task Graph

```mermaid
flowchart LR
    N0["N0<br/>Activate Track"]
    N1["N1<br/>Foundation"]
    N2["N2<br/>Canonical Store"]
    N3["N3<br/>Draft Sessions"]
    N4["N4<br/>Operation Engine"]
    N5["N5<br/>Character / Location"]
    N6["N6<br/>Canonical Commit"]
    N7["N7<br/>Rebase / Conflict"]
    N8["N8<br/>Conversation / Events"]
    N9["N9<br/>Outline"]
    N10["N10<br/>Manuscript / Publication"]
    N11["N11<br/>Projection / Recovery"]

    N0 --> N1 --> N2 --> N3 --> N4 --> N5 --> N6 --> N7 --> N8 --> N9 --> N10 --> N11
```

## 6. Task N0: Activate the Novel Track

### N0-A Implementation Plan

Create this implementation plan and update repository execution documents so Novel work is no longer described as deferred.

### N0-B Deliverables

- `docs/novel-implementation-plan.md`
- `AGENTS.md` active-track and recovery instructions
- `docs/implementation-plan.md` reference to the separate Novel track
- `docs/architecture.md` removal of the stale claim that the Novel domain is intentionally deferred

### N0-C Exit Criteria

- Novel N0 through N11 is the documented current active track.
- Runtime Task 1 through Task 7 is paused rather than deleted.
- Tool implementation remains excluded.
- Recovery reading includes this plan while the Novel track is active.

**Status:** completed by the commit that introduces this plan.

## 7. Task N1: Novel Foundation Protocols

### N1-A Module Skeleton

Create platform-neutral and Node adapter roots:

```text
core/src/novel/
core/src/node/novel/
```

Add explicit index exports without adding Tool code.

### N1-B Stable Identities

Define opaque public identities required by infrastructure:

```text
NovelId
NovelDraftSessionId
NovelOperationId
NovelCommitId
NovelConflictId
NovelArtifactId
```

### N1-C Version Contracts

Define and validate distinct contracts:

```text
NovelRevision
NovelSchemaVersion
NovelEntityVersion
```

`NovelRevision` remains opaque and equality-only. `NovelSchemaVersion` is migration state. `NovelEntityVersion` supports entity replacement and conflict preconditions.

### N1-D Foundation Ports and Failures

Define Clock and ID factories plus payload-free public validation and lifecycle errors. Important files receive concise top-level purpose comments. Important execution boundaries use structured redacted logs without Novel payloads, text, paths, raw errors, stacks, or causes.

### N1-E Validation

Add focused foundation smoke coverage, then run the complete repository suite.

### N1-F Delivered

- platform-neutral `core/src/novel` and Node adapter `core/src/node/novel` public roots
- branded non-interchangeable Novel, Draft Session, Operation, Commit, Conflict, and Artifact identities
- safe ASCII identity capture that rejects blank, whitespace, path-shaped, control-shaped, and oversized identities without exposing rejected values
- distinct opaque NovelRevision, positive safe-integer NovelSchemaVersion and NovelEntityVersion, and canonical UTC NovelTimestamp contracts
- injectable Novel Clock and collision-resistant random Novel identity factory
- fixed payload-free protocol, Draft lifecycle, revision-conflict, and invariant failures
- focused compile-time brand isolation and runtime foundation smoke coverage

**Status:** completed by the focused Novel foundation commit.

## 8. Task N2: Canonical Novel Store

### N2-A Store Location

Define a Novel Store location derived from the accepted Workspace Store:

```text
storeDir/
├── runtime.sqlite
├── novel.sqlite
├── novel-staging/
├── novel-history/commits/
└── novel-artifacts/
```

Physical paths remain Node-only.

### N2-B Canonical Bootstrap

Create initial canonical schema and migrations for:

```text
novel_metadata
novel_commits
novel_outbox
novel_draft_sessions
novel_schema_migrations
```

### N2-C Identity and Migration Validation

Verify exact Workspace and Novel identity, monotonic schema migration, and fixed safe failures when a database belongs to another Workspace or is structurally invalid.

### N2-D Validation

Add canonical bootstrap, identity, migration, reopening, and redacted logging smoke coverage.

### N2-E Delivered

- Node-only Novel Store location derived from the accepted Workspace Store, with `novel.sqlite`, `novel-staging/`, `novel-history/commits/`, and `novel-artifacts/`
- compatibility with the existing Runtime Workspace database path, which remains `workspace.databasePath` and currently resolves to `novel.db`; Novel N2 does not rename or migrate Runtime storage
- canonical SQLite control schema for metadata, Draft lifecycle records, Commit metadata, transactional Outbox records, and ordered schema migrations
- immutable canonical metadata with exact Workspace binding, optional expected Novel identity validation, opaque current revision, and schema version
- strict contiguous migration-history validation and fixed safe failures for foreign Workspace, foreign Novel, unsupported schema, malformed structure, and closed Store access
- idempotent close behavior and structured lifecycle logs containing identifiers and safe status metadata only
- focused smoke coverage for path layout, canonical bootstrap, reopen stability, identity mismatch, future or altered migration history, malformed databases, driver-open failure, and log redaction

**Status:** completed by the focused canonical Novel Store commit.

## 9. Task N3: Durable Draft Sessions

### N3-A Draft Protocol

Implement Draft identity, status, base revision, owner Conversation, and lifecycle services without Commit or Rebase behavior.

### N3-B Consistent Snapshot

Use the Node `node:sqlite` backup API behind `NovelSnapshotter` to create `draft.sqlite` from the exact canonical base revision. Ordinary filesystem copy is not an accepted snapshot implementation.

### N3-C Lifecycle

Implement:

```text
startDraft
getActiveDraft
resetToMain
rollback
recoverDraftSessions
```

`startDraft` never overwrites an existing active Draft. `rollback` terminates the Draft. `resetToMain` preserves the session identity while replacing its working state from the latest canonical revision.

### N3-D Validation

Cover multiple Conversation Drafts, same-Conversation exclusivity, restart recovery, reset, rollback, snapshot failure cleanup, and path redaction.

### N3-E Delivered

- immutable Draft Session protocol covering identity, owning Conversation, base NovelRevision, lifecycle status, and timestamps
- platform-neutral canonical Draft Store and Novel Snapshotter ports with no physical path exposure
- canonical SQLite Draft records enforcing one non-terminal Draft per top-level Conversation
- durable per-Conversation staging layout containing `manifest.json`, `draft.sqlite`, and an Artifact directory
- WAL-aware `node:sqlite.backup()` snapshots with source and destination revision validation; ordinary filesystem copying is not used
- lifecycle services for `startDraft`, `getActiveDraft`, `resetToMain`, and `rollback`, with same-Conversation serialization and cleanup compensation
- restart recovery that reopens valid Drafts, reconciles completed reset snapshots, rolls back missing or invalid working copies, removes terminal working state, and deletes orphan snapshots
- focused coverage for concurrent Conversation Drafts, exclusivity, reopen recovery, latest-revision reset, rollback, orphan and missing snapshots, failed snapshot cleanup, and path/content redaction

**Status:** completed by the focused durable Draft Session commit.

## 10. Task N4: Domain Operation Engine

### N4-A Operation Protocol

Define immutable versioned Domain Operations and preconditions. Operations contain no closures, raw SQL, Provider requests, or deferred content generation.

### N4-B Registry and Executor

Implement a typed Operation Registry and executor behind platform-neutral repository ports.

### N4-C Draft Operation Journal

Create Draft control tables for ordered Operations, digests, metadata, conflicts, projections, and outbox state as required by the implemented step.

### N4-D Serialized Draft Writer

One short Draft SQLite transaction validates an Operation, records it, applies it through a handler, updates Draft metadata, and records the outbox item. Queue failure cannot poison later writes.

### N4-E Validation

Cover protocol immutability, JSON-only payload admission, branded Operation versions, precondition validation, duplicate registration, missing handlers, and synchronous Handler enforcement.

### N4-F Delivered

- immutable versioned Domain Operation envelopes with branded Operation IDs and Operation versions
- discriminated entity-exists, entity-absent, entity-version, and field-digest preconditions
- canonical JSON capture that rejects closures, `undefined`, non-finite numbers, cycles, and non-plain objects
- typed Operation Registry keyed by Operation type and version
- asynchronous public Executor boundary whose transaction-facing Handler must complete synchronously
- fixed payload-free failures for invalid Operations, duplicate registration, missing handlers, and asynchronous Handler implementations
- focused compile-time brand separation and runtime protocol/registry smoke coverage
- accepted canonical Operation digest over the complete envelope using shared canonical JSON, UTF-8, SHA-256, and `sha256:<64 lowercase hexadecimal characters>`
- versioned Draft-local metadata, ordered Operation Journal, conflict, projection, and durable Outbox control tables initialized on every new or reset snapshot
- atomic duplicate detection, Operation Journal append, synchronous Handler application, metadata advancement, and Outbox insertion in one short SQLite transaction
- same Operation ID and Digest idempotency, with conflicting durable content rejected by a fixed identity-conflict failure
- per-Draft asynchronous Writer queues that preserve FIFO order, permit independent Drafts, and remain usable after a rejected write
- restart-safe sequence continuation and focused coverage for canonical Digest validation, duplicate identity, ordering, transaction rollback, post-failure recovery, restart recovery, and redacted logs using private test Operations

**Status:** completed by the focused Domain Operation Engine commit.

## 11. Task N5: Character and Location Vertical Slice

Character and Location are the first concrete domain slice because their accepted contracts do not depend on the deferred types in Section 4.

### N5-A Models and Schema

Implement accepted Character and Location identities, stable profile fields, entity versions, canonical tables, and Draft tables through shared schema migration semantics.

### N5-B Operations

Implement deterministic create, full-replace, and safe-delete Operations with preconditions. Dynamic story state remains excluded from stable profiles.

### N5-C Services and Queries

Implement Character and Location application and query services against explicit canonical or Draft read scopes. No Tool adapters are added.

### N5-D Validation

Cover Draft create/replace/delete, canonical isolation, entity-version conflicts, restart recovery, invalid profile fields, and content-safe logs.

### N5-E Delivered

- branded Character and Location identities plus strict progressively completed stable-profile models
- shared canonical and Draft SQLite schema for versioned Character and Location records
- deterministic create, full-replace, and safe-delete Operations with exact payload and precondition validation
- atomic Draft execution through the shared Operation Registry, Mutation Service, per-Draft Writer, Journal, entity tables, and Outbox
- platform-neutral Character, Location, and explicit-scope query services with a Node SQLite composition factory
- canonical isolation, entity-version rollback, restart recovery, dynamic-field rejection, malformed Operation rejection, and content-safe log coverage

**Status:** completed by the focused Character and Location vertical-slice commit.

## 12. Task N6: Canonical Commit

### N6-A ChangeSet

Freeze the effective Draft Operation sequence, validate its canonical form, calculate its digest, and stop later mutation from joining that ChangeSet.

The accepted ChangeSet digest identity is separate from the deferred Commit history payload encoding:

```text
canonicalStringifyJson({
  changeSetVersion,
  novelId,
  baseRevision,
  operationCount,
  lastOperationSequence,
  operations: [{ sequence, operationDigest }]
})
    -> UTF-8
    -> SHA-256
    -> sha256:<64 lowercase hexadecimal characters>
```

- Draft Session ID and freeze timestamp identify the durable frozen record but do not participate in content identity.
- Operation envelopes are protected by their previously accepted complete-envelope digests.
- Array order and explicit sequence values both participate in the ChangeSet digest.
- Freezing uses the same per-Draft Writer queue plus a durable SQLite compare-and-set, so a concurrent write is either included before the freeze or rejected afterward.
- This contract does not choose the N6-C history filename, JSON/JSONL payload encoding, preparation, cleanup, or recovery protocol.

**Status:** completed by the focused frozen ChangeSet commit.

### N6-B Commit Writer

Serialize canonical Commit for one Novel, validate base revision, replay the complete ChangeSet, validate final invariants, insert Commit metadata, increment NovelRevision exactly once, and insert the canonical outbox record in one short SQLite transaction.

### N6-C History Payload

The immutable Commit history payload protocol is accepted as follows:

```text
novel-history/commits/<commitId>.json
```

- `payload_ref` stores only the safe basename `<commitId>.json`; absolute paths never enter platform-neutral contracts or canonical metadata.
- The payload is canonical JSON encoded as UTF-8 with no byte-order mark and no trailing newline.
- The exact version-1 envelope is:

```ts
interface NovelCommitPayloadV1 {
  readonly payloadVersion: 1;
  readonly commitId: NovelCommitId;
  readonly novelId: NovelId;
  readonly draftSessionId: NovelDraftSessionId;
  readonly ownerConversationId: string;
  readonly baseRevision: NovelRevision;
  readonly resultRevision: NovelRevision;
  readonly changeSetDigest: NovelChangeSetDigest;
  readonly operationCount: number;
  readonly committedAt: NovelTimestamp;
  readonly operations: readonly {
    readonly sequence: number;
    readonly operationDigest: NovelOperationDigest;
    readonly operation: NovelOperation;
  }[];
}
```

- `payload_digest` is SHA-256 over the exact payload bytes and uses `sha256:<64 lowercase hexadecimal characters>`.
- `payload_size` is the exact UTF-8 byte length and must be a non-negative safe integer.
- Commit ID, result revision, committed timestamp, complete payload bytes, digest, and size are fixed before the canonical SQLite transaction starts.
- Preparation writes `.<commitId>.<nonce>.tmp` in the Commit directory using exclusive creation, flushes and fsyncs the file, atomically renames it to `<commitId>.json`, then fsyncs the directory.
- If the final file already exists, preparation verifies canonical bytes, digest, and size. An exact match is idempotently reused; any mismatch is a fixed Commit payload identity conflict.
- Immediately before inserting canonical Commit metadata, the Commit Writer reopens and verifies the prepared regular file, safe filename, exact size, and digest. SQLite never records an unverified payload reference.
- A failed or stale canonical transaction leaves the prepared final file as an orphan. Startup recovery and pre-Commit reconciliation run under the per-Novel Commit Writer, delete recognized temporary files, and remove recognized final payload files that are not referenced by `novel_commits`.
- Canonical Commit metadata remains authoritative if a referenced payload file later disappears. Recovery regenerates the exact payload only when the preserved frozen Draft still matches the stored ChangeSet digest; otherwise it reports a fixed history-integrity failure without deleting or rolling back the canonical Commit and without fabricating Operations.
- Retention duration for committed Drafts and broad Artifact quotas remain deferred; they may improve recoverability but do not change this protocol.

**Status:** protocol accepted; implementation proceeds in N6-B through N6-D.

### N6-D Validation

Cover success, complete rollback, stale revision, duplicate Commit identity, digest mismatch, outbox persistence, interrupted payload preparation, and restart recovery.

## 13. Task N7: Rebase and Conflict

### N7-A Rebase Candidate

Preserve the stale source Draft, snapshot the latest canonical revision into a sibling candidate, and replay source Operations with their original preconditions.

### N7-B Conflict Protocol

Implement the accepted conflict kinds and safe digest-based conflict snapshots without logging Novel content.

### N7-C Resolution

Implement `keep-canonical`, validated `keep-draft`, `drop-operation`, and manual replacement Operation strategies.

### N7-D Approval Invalidation

Any Rebase or conflict resolution that changes base revision or effective ChangeSet digest invalidates previous Approval.

### N7-E Validation

Use concurrent Character and Location Drafts to cover non-overlapping automatic Rebase, same-field conflict, delete/update conflict, idempotent create, manual resolution, crash recovery, and successful post-resolution Commit.

## 14. Task N8: Conversation and OutputEvent Integration

### N8-A Binding

Implement the Conversation-to-Novel and active-Draft binding boundary without making Conversation the Novel aggregate.

### N8-B Lifecycle Events

Define internal Novel lifecycle records and public Novel OutputEvents for Draft, Commit, Rebase, conflict, and recovery transitions. Payloads expose stable safe identities and metadata rather than Novel content.

### N8-C Outbox Dispatcher

Dispatch canonical and Draft outbox records idempotently through the accepted Conversation Output publisher and Runtime Journal boundary.

### N8-D Approval Bridge

Bind asynchronous Approval requests and responses to exact ChangeSet digests without holding SQLite transactions while waiting.

### N8-E Validation

Cover Event ordering, retry-stable IDs, dispatcher restart, duplicate delivery, Approval staleness, Conversation identity, and redacted logs.

## 15. Task N9: Story Outline Vertical Slice

This task begins only after its affected deferred contracts are explicitly resolved and recorded.

### N9-A StoryOutline and StoryUnit

Resolve `OrderKey`, then implement the ordered stable StoryUnit tree.

### N9-B Status and Reasons

Resolve `StoryUnitBlockState` and `StoryUnitAbandonment`, then implement planning, realization, blocking, abandonment, and derived parent progress.

### N9-C Leaf Plan

Resolve `StoryTimeDescription`, then implement LeafStoryUnitPlan and readiness validation.

### N9-D Event, Rhythm, and Entity Change

Implement StoryEventStep, RhythmBeat, StoryUnitEntityChange, and Character/Location bindings with stable IDs and ordering.

### N9-E Services, Operations, Queries, and Persistence

Add complete Draft and canonical vertical slices with Rebase and conflict behavior. Tool adapters remain excluded.

## 16. Task N10: Manuscript, Publication, and Realization

This task begins only after Anchor and Range contracts are explicitly resolved and recorded.

### N10-A Publication

Implement Volume and Chapter as publication structures separate from StoryOutline.

### N10-B Manuscript Blocks

Implement stable Paragraph Blocks and ordering without sentence-level domain objects.

### N10-C Anchors and Ranges

Resolve and implement ManuscriptAnchor and ManuscriptRange.

### N10-D Structural Repair

Implement Block move, split, merge, Tombstone, Redirect, and anchor repair Operations.

### N10-E Realization and Conformance

Implement StoryUnitRealization, current revision binding, conformance findings, and completion admission.

## 17. Task N11: Projection, Recovery, and End-to-End Validation

### N11-A Projections

Implement Character and Location state, contextual readiness, relationship, and conformance projections as repairable revision-bound views.

### N11-B Recovery

Implement Draft corruption detection, incomplete Commit recovery, outbox retry, interrupted Rebase recovery, staging retention, orphan cleanup, and projection rebuild.

### N11-C End-to-End Validation

Cover multi-Conversation Drafts, Commit, Rebase, conflict, Approval, Outline, Manuscript, publication, realization, recovery, and replay without Agent Tool involvement.

### N11-D Documentation and Examples

Update accepted architecture diagrams and add platform-neutral application examples. Tool examples remain deferred.

## 18. Milestones

### Milestone A: Durable Novel Workspace

Tasks N0 through N4 provide canonical storage, Draft SQLite, Operation Journal, and restart-safe Draft mutation.

### Milestone B: Concurrent Domain Commit

Tasks N5 through N8 provide a real Character/Location slice with Commit, Rebase, conflict, Approval, and OutputEvent integration.

### Milestone C: Story Planning

Task N9 provides the accepted ordered Story Outline and rolling Leaf Plan model.

### Milestone D: Manuscript Production

Tasks N10 and N11 provide manuscript, publication, realization, conformance, projections, and recovery.

## 19. Current Position

- Task N0 is completed by the commit introducing this plan.
- Task N1 is completed by the focused Novel foundation commit.
- Task N2 is completed by the focused canonical Novel Store commit.
- Task N3 is completed by the focused durable Draft Session commit.
- Task N4 is completed by the focused Domain Operation Engine commit.
- Task N5 is the next implementation task.
- Agent-facing Novel Tools remain deferred beyond Task N11.
