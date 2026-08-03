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

`TodoAwareRuntimeSystemPromptSource` composes the configured base prompt with a
`<CURRENT_TODOS>` overlay before each Provider call. This is Runtime state, not
a Message and not a temporary Nudge, so context compaction does not remove the
current plan. The prompt overlay contains no hidden execution authority; it is
descriptive state for the Agent.

`TodoRead` is intentionally deferred. Runtime context already exposes the
current list, while clients read the OutputEvent stream or the Todo projection.
