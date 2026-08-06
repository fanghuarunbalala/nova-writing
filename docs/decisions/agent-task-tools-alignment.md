# Decision: Agent Execution and Work-Item Tools Alignment

Status: accepted
Date: 2026-08-06

## Accepted direction

- Tool names align with the reference implementation: `Agent` (spawn, always
  non-blocking, default background), `TaskOutput` (runIds + block + any-first
  terminal), `TaskStop` (terminate), and Work-Item Tools
  `TaskCreate`/`TaskList`/`TaskGet`/`TaskUpdate`.
- Subagents use `TodoWrite` in their own Conversation; Work-Item Tools are
  Main/Team-only. Team = TaskList; standalone sessions own private lists.
- No Sleep, no wait conditions, no autonomous wake; terminal OutputEvents are
  observable but never projected as parent messages.
- Work-item and Todo state are Runtime metadata and never trigger Approval.
- Scheduling (Cron) is deferred out of scope.

## Supersedes

- `agent-orchestration.md` §6 (renames `Task`/`TaskGet`/`TaskCancel`), §15
  (Sleep removed), §16 (storage list), §19 (unresolved items 1 and 6).
