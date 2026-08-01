# Task 4 Policy, Compaction, and Nudge Decision Proposal

Status: **partially accepted — Nudge protocol only**

This document collects the recommended first-version decisions required before Task 4 implementation. The Nudge decisions in Sections 8 through 12 are accepted with the explicit changes recorded below. Sections 1 through 7 remain proposals and do not authorize Runtime crash recovery or Context Compaction implementation.

`docs/implementation-plan.md` and `docs/architecture.md` are the authoritative implementation contracts.

## 1. Runtime Crash Recovery Dependency

Recommendation:

- recover a non-terminal Run or Turn as `failed`, not `cancelled`
- introduce the lifecycle reason `runtime_crash_recovered`
- preserve the original Input outcome and append only the missing lifecycle terminal Events
- never imply that a persistence-first cancellation barrier completed when the Runtime crashed

Rationale: `cancelled` represents a coordinated cancellation intent and acknowledged cancellation path. A crash is an execution failure with unknown intermediate external state.

## 2. Context Pressure Thresholds

Recommendation:

- soft reminder threshold: 70% of the effective Provider context budget
- compaction threshold: 82%
- hard admission threshold: 92%
- calculate thresholds from the effective budget after reserved Provider output and protocol overhead

The hard threshold remains an execution limit, not a Nudge.

## 3. Post-compaction Target and Hysteresis

Recommendation:

- compact to at most 55% of the effective context budget
- require new uncompacted content equal to at least 10% of the effective budget before another automatic compaction
- also require an absolute minimum of 8,192 estimated tokens unless the hard threshold would otherwise be crossed

## 4. Always-pinned Context

Recommendation:

- current Input and its exact projection
- latest complete Turn
- unresolved Interaction and Approval state
- active Tool invocation and unresolved Tool result state
- explicit pinned Message IDs supplied by the Agent definition or Runtime
- lifecycle facts required to interpret the active Run

Core must not define Novel-specific pinned fields in Task 4.

## 5. ContextCheckpoint Schema

Recommendation:

- retain the architecture fields for source range, covered-through Sequence, summary, facts, decisions, constraints, unresolved tasks, pinned Message IDs, recent window, and token estimates
- add `schemaVersion`, `createdAt`, `compactorId`, `compactorVersion`, and a canonical content digest
- reference source Messages by durable Message ID and source Journal Sequence rather than copying Event payloads

## 6. ContextCompactor Selection

Recommendation:

- define a provider-neutral, asynchronous `ContextCompactor` port
- allow Agent/runtime composition to select the active Provider, a dedicated model, or a local implementation
- provide no hard-coded model selection in Core
- permit an active-Provider adapter as the first external implementation

## 7. Compaction Result Validation

Recommendation:

- validate schema and canonical JSON safety
- validate exact Conversation identity and requested source range
- require all pinned Messages and required Runtime facts to remain represented
- require a non-empty summary and valid structured fields
- require the covered-through Sequence to be monotonic
- require the estimated result to be smaller than the source and at or below the target ratio
- reject without activating or replacing the previous Checkpoint when validation fails

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

The following Compaction recommendations remain unaccepted:

- Compaction started
- Compaction completed
- Compaction failed with a fixed failure category
- ContextCheckpoint activated

Token-estimate diagnostics also remain part of the unaccepted Compaction design.

Public Events and logs must not contain Reminder text, Message content, summaries, Prompt text, source excerpts, credentials, paths, raw errors, stacks, or causes.

## 13. Review Outcome Required

Review outcome:

- Sections 8 through 12: accepted with the explicit changes recorded above
- Sections 1 through 7: still proposed and require separate review

Only the accepted Nudge protocol may proceed to implementation. Runtime Policy behavior beyond the provider-neutral Nudge contracts and all Context Compaction behavior remain behind separate review gates.
