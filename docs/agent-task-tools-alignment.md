# Agent Execution and Work-Item Tools Alignment

## 1. Status and Boundary

This document records the accepted direction for aligning Agent execution and
work-item tool naming and semantics with the reference implementation. It
supersedes the corresponding sections of `agent-orchestration.md` (renames,
removal of Sleep, storage list, and unresolved items) and clarifies the
`TodoWrite` position in `runtime-todo.md`.

The decisions here are design-direction records. Implementation proceeds
through focused, separately validated and committed steps; Runtime and Novel
changes are never mixed in one commit.

## 2. Decisions

| Item | Decision |
|---|---|
| Layering | Work-Item Tools (planning) are separated from Execution Tools |
| Subagent planning | Ephemeral Subagents use `TodoWrite` in their own Conversation |
| `Agent` | Always non-blocking; defaults to background execution |
| `TaskOutput` | `runIds` + optional `block` + `timeout`; any-first terminal wins |
| Wake | No Sleep, no wait conditions, no autonomous wake |
| Scheduling | Deferred out of scope; a Cron-style mechanism would be used later |
| List ownership | Standalone sessions own private lists; Team = TaskList shared list |
| Approval | Work-item and Todo state are Runtime metadata and never trigger Approval |

## 3. Toolset

### 3.1 Work-Item Tools (Main Agent and Team members only)

```ts
TaskCreate { subject; description; activeForm?; metadata? }          -> { taskId, status: "pending" }
TaskList   { status?; owner? }                                        -> { tasks }
TaskGet    { taskId }                                                 -> { task }
TaskUpdate { taskId; subject?; description?; status?; owner?; blocks?; addBlockedBy?; metadata? } -> { task }
```

Status: `pending | in_progress | completed` plus `deleted` via `TaskUpdate`.
List resolution: Main Agent uses its own Conversation list; Team leader and
members use the shared team list.

### 3.2 Execution Tools

```ts
Agent     { agentType; prompt }                                       -> { runId, agentId, status, acceptedAt }
TaskOutput{ runIds; block? = false; timeout? = 30000, max 600000 }
  block:false -> { retrieval: "snapshot", runs }
  block:true  -> { retrieval: "success", run, otherRuns }   // first terminal wins
              | { retrieval: "timeout", runs }
TaskStop  { runId }                                                  -> { outcome: cancellation_requested | already_terminal | not_found }
```

Terminal OutputEvents remain published for observability and replay but are
never projected as a parent user message and never start a new parent turn.
The main Agent manages background runs within its own turn.

### 3.3 Subagent planning

Ephemeral Subagents receive `TodoWrite` against their own Conversation
(existing per-Conversation Runtime todo state, `<CURRENT_TODOS>` overlay).

## 4. Tool Visibility Matrix

| Tool | Main / Leader | Team member | Ephemeral Subagent |
|---|---|---|---|
| TaskCreate / TaskUpdate | Yes (own/team list) | Yes (shared team list) | No |
| TaskList / TaskGet | Yes | Yes (shared team list) | No |
| TodoWrite | Yes (non-interactive fallback) | Yes | Yes (own Conversation) |
| Agent | Yes | Yes (if definition permits) | No |
| TaskOutput | Yes (any run) | No | No |
| TaskStop | Yes | No | No |

`TaskOutput` and `TaskStop` are main-thread execution Tools only.

## 5. Data Model

```text
agent_task_lists   (listId PK = conversationId | teamName)
agent_tasks        (taskId, listId, subject, description, status, owner?, blocks, blockedBy, metadata, timestamps)
agent_runs         (runId, agentId, parentConversationId, status, resultMessageId?, outputSummary?, timestamps)
conversation_todo  (existing, per-Conversation)
```

All of the above are Runtime metadata: never novel.sqlite, never draft.sqlite,
never a ChangeSet, never Approval. Shared team lists require concurrent write
safety (file lock + high-watermark ID, matching the reference implementation).

Implementation follows the journal-first projection pattern established by
`TodoWrite`: each mutation appends a complete `agent.tasks.updated` OutputEvent
to the acting Conversation journal, and the in-memory list store is rebuilt by
replaying those events. `agent_task_lists` and `agent_tasks` are logical
storage; cross-process locking for shared team lists is deferred to the
persisted store step.

## 6. Boundary Rules

1. Work-item and Todo state changes never trigger Approval (independent of
   Novel ChangeSet Approval).
2. Agent domain writes flow through the parent Draft Session (serialized Draft
   Writer); draft -> commit -> human approval is unchanged.
3. No autonomous wake: a main Agent must not end its turn while depending on
   background results; it waits in-turn with `TaskOutput` or ends with a status
   report and is continued by a new user message.
4. Crash recovery: orphan reclamation plus explicit `TaskOutput` queries.
5. Domain data (canonical, Draft, Artifact) is shared through query services;
   no reference parameters on `Agent`.
6. Public Core boundaries remain provider-neutral (no Pi, placement, Node, or
   SQLite exposure).

## 7. Naming Migration

| Current | Target |
|---|---|
| `Task` (spawn subagent) | `Agent` |
| `TaskGet` (subagent query) | `TaskOutput` (runIds / block / any-first) |
| `TaskCancel` | `TaskStop` (transition alias) |
| (none) | `TaskCreate` / `TaskList` / `TaskUpdate` |
| `TaskAssignedInputEvent` | unchanged (protocol stable) |

## 8. Implementation Phases

### Phase A: Work-Item Layer

- `agent_task_lists` + `agent_tasks` tables (journal-first projection pattern);
- `TaskCreate` / `TaskList` / `TaskGet` / `TaskUpdate`;
- list resolution (teamName > conversationId) and role-bound Tool views
  (Main/Team receive Task Tools; Ephemeral views receive TodoWrite only);
- focused smoke; commit. **Status: implemented (protocol layer, Task tools,
  role view, boundary smoke).**

### Phase B: Execution Layer Alignment

- rename `Task` -> `Agent` (`{ agentType, prompt }`);
- `TaskOutput` (runIds / block / first-terminal) replaces subagent query;
- `TaskStop` replaces `TaskCancel`;
- terminal events no longer projected as parent messages;
- Ephemeral Subagent Registry View converges to `TodoWrite` + read-only domain
  queries;
- extend `runtime-subagent-validation-smoke`; commit.

### Phase C: Boundary Acceptance

- visibility matrix assertions;
- Approval independence;
- crash recovery;
- GUI read-only unchanged;
- full validation suite; commit.

## 9. Acceptance Scenarios

1. Main Agent spawns 3 background runs in parallel; `TaskOutput({runIds,
   block:true})` returns as soon as the first reaches terminal state; the
   remainder are waited for explicitly.
2. A Subagent Registry View contains no Work-Item Tools (asserted).
3. After `TeamCreate`, leader and members resolve to the same team task list;
   after `TeamDelete`, the leader returns to a private list.
4. A run completing after the main Agent ended its turn produces no parent
   user message (no ghost turn).
5. After a process restart, orphaned runs are queryable through `TaskOutput`.

## 10. Document Changes

- `agent-orchestration.md`: §1, §5, §6, §7.2, §11, §12, §14, §15, §16, §17,
  §18, §19;
- `runtime-todo.md`: Subagent planning tool section;
- `docs/decisions/agent-task-tools-alignment.md`: decision record.

## 11. Deferred Follow-Up

The legacy chat-first novel GUI shell (`ui/src/novel` read cache, canonical
card projectors, Inspector renderers, sidebar badges) was built on the
pre-Phase-3 UI architecture and is not carried into the merged trunk. The
read-only canonical Novel display features are deferred to a follow-up port
onto the Phase-3 `ui/src/domains/novel` architecture; the Runtime work-item
and execution Tool layers in this document are unaffected.
