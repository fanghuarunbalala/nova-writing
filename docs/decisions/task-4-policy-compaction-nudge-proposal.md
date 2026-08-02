# Task 4 Policy, Compaction, and Nudge Decision Proposal

Status: **partially accepted — Nudge and Context Compaction protocols**

This document collects the recommended first-version decisions required before Task 4 implementation. The Context pressure and Compaction decisions in Sections 2 through 7 and the Nudge decisions in Sections 8 through 12 are accepted with the explicit changes recorded below. Section 1 remains proposed and does not authorize Runtime crash terminal repair.

`docs/implementation-plan.md` and `docs/architecture.md` are the authoritative implementation contracts.

## 1. Runtime Crash Recovery Dependency

Recommendation:

- recover a non-terminal Run or Turn as `failed`, not `cancelled`
- introduce the lifecycle reason `runtime_crash_recovered`
- preserve the original Input outcome and append only the missing lifecycle terminal Events
- never imply that a persistence-first cancellation barrier completed when the Runtime crashed

Rationale: `cancelled` represents a coordinated cancellation intent and acknowledged cancellation path. A crash is an execution failure with unknown intermediate external state.

## 2. Context Pressure Thresholds

Accepted decision:

- soft reminder threshold: 70% of the effective Provider context budget
- compaction threshold: 82%
- hard admission threshold: 92%
- calculate thresholds from the effective budget after reserved Provider output and protocol overhead
- include Base Prompt, selected Tool schemas, persistent Checkpoint Overlay, one-shot Nudge reserve, projected canonical Messages, and active transient Messages in the candidate estimate
- evaluate pressure before each Provider call because Tool results may increase Context inside one Agent Run

The hard threshold remains an execution limit, not a Nudge.

## 3. Post-compaction Target and Hysteresis

Accepted decision:

- compact to at most 55% of the effective context budget
- require new uncompacted content equal to at least 10% of the effective budget before another automatic compaction
- also require an absolute minimum of 8,192 estimated tokens unless the hard threshold would otherwise be crossed
- treat 55% as a target rather than a binary activation requirement
- require configurable meaningful savings, with a recommended default of `max(5% of effective budget, 2,048 estimated tokens)`, unless the result reaches the measured irreducible floor
- suppress duplicate automatic attempts for the same Conversation, source digest, Compactor ID, and Compactor version

## 4. Always-pinned Context

Accepted decision:

- current Input and its exact projection
- latest complete Turn
- unresolved Interaction and Approval state
- active Tool invocation and unresolved Tool result state
- explicit pinned Message IDs supplied by the Agent definition or Runtime
- lifecycle facts required to interpret the active Run
- active transient Messages not yet represented in durable canonical history
- preserve Tool-call/result, Interaction/response, Approval/response, and complete-Turn Message Groups atomically without summarizing, reordering, role rewriting, or partial omission
- distinguish permanent, conditional, and sliding pin lifetimes

Core must not define Novel-specific pinned fields in Task 4.

## 5. ContextCheckpoint Schema

Accepted decision:

- retain source range, covered-through Sequence, summary, structured facts, decisions, constraints, unresolved tasks, pinned Message IDs, recent window, and token estimates
- add `schemaVersion`, `createdAt`, `parentCheckpointId`, `compactorId`, `compactorVersion`, canonical source digest, and canonical content digest
- represent structured items with stable item identity, priority, durable source Message references, and optional logical Artifact references
- keep Checkpoints immutable and private; public Events never contain summary or item text
- separate the complete durable `ContextCheckpoint` from the per-Provider-call budgeted `ContextProjection`

## 6. ContextCompactor Selection

Accepted decision:

- define a provider-neutral, asynchronous `ContextCompactor` port
- allow Agent/runtime composition to select the active Provider, a dedicated model, or a local implementation
- provide no hard-coded model selection in Core
- permit an active-Provider adapter as the first external implementation
- never silently switch Provider or model after Compaction failure
- permit mandatory deterministic structural validation and a separate optional semantic-validation port

## 7. Compaction Result Validation

Accepted decision:

- validate schema and canonical JSON safety
- validate exact Conversation identity and requested source range
- validate source digest, Checkpoint lineage, and monotonic covered-through Sequence
- require all pinned Message Groups and required Runtime facts to remain represented exactly
- require a non-empty summary and valid structured fields
- validate every structured source reference and Artifact reference
- reject Nudge content from Checkpoint memory
- require the estimated result to be meaningfully smaller than the source unless it reaches the irreducible floor
- reject without activating or replacing the previous Checkpoint when validation fails

Accepted Compaction outcomes:

- `target_met`: valid result at or below the 55% target
- `reduced`: valid meaningful result below the 82% request threshold
- `degraded`: valid meaningful result below the 92% hard boundary while pressure remains
- `unreducible`: the irreducible floor or validated result remains at or above the hard boundary, or no safe meaningful result exists

The irreducible floor contains Base Prompt, selected Tool schemas, pinned Message Groups, current Input, active transient state, and required protocol overhead. A floor at or above the hard limit fails before invoking the Compactor.

## 7A. Oversized Content and Artifact References

Accepted decision:

- materialize oversized User content, Tool results, and verbose Checkpoint detail into a durable Conversation-owned `ArtifactStore`, not an ephemeral cache, when later replay or retrieval depends on the content
- store stable logical Artifact IDs, content type, byte length, token estimate, digest, and optional filename without exposing local paths
- let canonical Messages and Checkpoints reference Artifacts rather than copying oversized content into every Provider call
- require bounded byte, line, match, and token limits plus continuation cursors for Artifact read, grep, search, and metadata access
- keep concrete Tool result materialization, Artifact access handlers, permission approval, and sandboxing in Task 5
- address oversized Tool schemas through Agent-specific Tool Groups and dynamic mounting rather than Artifact references

## 7B. Projection Degradation

Accepted decision:

- preserve complete Checkpoints while selecting a budgeted `ContextProjection` for each Provider call
- apply degradation in the order: normal structured Compaction, stronger structured Compaction, durable Artifact offload, priority-budgeted Checkpoint Projection, recent-window reduction to the latest complete Turn, then hard failure
- omit low-priority and then normal-priority Checkpoint segments before high-priority segments; never automatically omit critical segments or pinned Message Groups
- treat omission as a one-call Projection decision rather than deletion from Journal, Messages, Checkpoint Store, or Artifact Store
- block Provider dispatch with a fixed safe failure when critical and pinned content still cannot fit below the hard boundary

## 7C. Context Layers and Lifecycle Events

Accepted decision:

- compose Provider Context as Base System Prompt, persistent Checkpoint Overlay, one-shot Nudge Overlay, then pinned, recent, and transient Messages
- render Checkpoint content through a fixed delimited historical-data template rather than fabricating a User Message
- publish Compaction started, completed, failed, and Checkpoint-applied OutputEvents
- keep ordinary Policy evaluation, request decisions, hysteresis suppression, duplicate suppression, candidate ranking, and projection omission as internal structured traces
- allow public Compaction Events to contain safe identities, source ranges, outcomes, and token estimates, but never Message content, summaries, Prompt text, source excerpts, Artifact paths, raw errors, stacks, or causes

## 8. Per-call Nudge Limit

Accepted decision:

- select one Nudge by default and never inject more than two Nudges into one Provider call
- filter by target, expiry, and cooldown before ordering candidates
- apply deterministic priority-descending ordering followed by scheduled Journal Sequence ascending
- allow a policy to declare itself exclusive when its Reminder must be delivered alone
- expose the selected items to the Provider as one temporary `SystemReminderOverlay` block
- support only `system-prompt-overlay` placement initially; `context-tail` is not part of the first version

## 9. Nudge Scheduling Rules

Accepted decision:

- integer priority with higher values selected first
- stable deduplication key supplied by the Policy and scoped by the owning Conversation Runtime
- cooldown measured primarily in completed Turns, with optional wall-clock expiry
- expiry may target a maximum Turn number or an absolute timestamp; Run targeting is explicit through `targetRunId`
- configuration belongs to the Policy definition and Runtime config, not Message payloads
- a Nudge carries `templateId`, `templateVersion`, and JSON-safe `parameters`; Policy code cannot inject arbitrary rendered Reminder text
- cooldown starts only after the Nudge is consumed at the Provider dispatch boundary
- an exclusive Nudge is selected alone even when the per-call hard maximum would allow another item

## 10. Delivery Boundary

Accepted decision:

- a Nudge becomes delivered and consumed only when the Provider request containing it is dispatched
- Context compilation, Adapter request construction, and stream reservation do not count as delivery
- emit `SystemReminderInjectedOutputEvent` only after this dispatch barrier
- a consumed Nudge never enters canonical Runtime Messages or a `ContextCheckpoint` summary

## 11. Lease Recovery

Accepted decision:

- persist lease identity with Provider call ID and lease timestamp
- release to `scheduled` when failure is known to occur before dispatch
- keep `consumed` when dispatch occurred even if streaming later fails
- after restart, return an unconfirmed lease to `scheduled` only when no durable dispatch confirmation exists
- make consume and release operations idempotent

## 12. Public Events and Internal Traces

Accepted decision:

Public durable OutputEvents:

- Nudge scheduled
- Nudge delivered
- Nudge expired

The public Nudge Event payload contains only identifiers, template metadata, and lifecycle state. It never contains rendered Reminder text or template parameters.

Internal structured traces only:

- lease release before Provider dispatch
- ordinary Policy evaluation
- non-triggered Policy decisions
- cooldown and deduplication suppression
- candidate ranking

Accepted public Compaction Events:

- Compaction started
- Compaction completed after a valid Checkpoint is persisted
- Compaction failed with a fixed failure category
- ContextCheckpoint applied to one concrete Provider call

Safe token-estimate diagnostics are accepted as public metadata. Summary text and source content remain private.

Public Events and logs must not contain Reminder text, Message content, summaries, Prompt text, source excerpts, credentials, paths, raw errors, stacks, or causes.

## 13. Review Outcome Required

Review outcome:

- Section 1: still proposed and requires separate review
- Sections 2 through 7C: accepted with the explicit changes recorded above
- Sections 8 through 12: accepted with the explicit changes recorded above

The accepted Nudge and Context Compaction protocols may proceed to implementation. Runtime crash terminal repair, Runtime Policy effects beyond Nudge and Context Compaction, concrete Artifact persistence, Tool Artifact access, Tool permissions, Novel-specific memory, and Subagent scheduling remain behind their own task boundaries or review gates.
