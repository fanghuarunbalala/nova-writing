# Runtime TodoWrite

`TodoWrite` is the Runtime execution-plan Tool. It records the current plan of
one Conversation; it does not modify Novel StoryUnit, manuscript, or outline
state.

## Three-layer placement

```text
core/src/tooling/                 provider-neutral Tool contracts and Registry
core/src/tools/todo/TodoWrite.ts concrete Tool schema, descriptor, and handler
core/src/runtime/todo/            state, Journal event coordination, projection,
                                  and system-context contribution
```

The concrete Tool depends on the narrow `ConversationTodoWriter` Port. It does
not know the database, Journal implementation, provider, or process placement.

## Write semantics

`TodoWrite` accepts a complete list and atomically replaces the current
Conversation snapshot. Each item has a stable `id`, `content`, and one of:
`pending`, `in_progress`, `completed`, or `cancelled`. The first Runtime
version permits at most one `in_progress` item and up to 32 items.

An empty list clears the current plan. The Tool result returns only the new
revision and counts. The full list is carried by `AgentTodoUpdatedOutputEvent`
so clients can render and replay it without merging patches.

## Durability and replay

`ConversationTodoCoordinator` appends the OutputEvent through the Runtime event
sink before updating the local projection. If the projection is lost, replay
can call `ConversationTodoProjector.apply()` for each durable
`agent.todo.updated` snapshot. Older revisions are ignored.

Each Conversation owns its own Todo state. A Subagent writes only to its own
Conversation; parent/child visibility belongs to the existing Subagent event
projection rather than cross-Conversation Todo mutation.

## Provider context

The current execution plan is delivered to the Provider as a `todo_reminder`
`system.reminder` message (aligned with the CCB attachment semantics), built by
`TodoPromptContributor.buildReminderMessage()` and merged with the canonical
messages by `PromptAssemblyBuilder`. Reminder messages are append-only and never
deleted by compaction or projection, keeping the message prefix stable so
Provider prefill caches stay valid.

`TodoAwareRuntimeSystemPromptSource` (the legacy implementation that appended
`<CURRENT_TODOS>` into the System Prompt string) is not wired and is deprecated:
the System Prompt carries only the stable base, and all dynamic content lives in
the message layer.

`TodoRead` is intentionally deferred. Runtime context already exposes the
current list through the reminder message, while clients read the OutputEvent
stream or the Todo projection.
