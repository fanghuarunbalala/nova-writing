# Runtime Client Integration

## Shared Contract

CLI, TUI, desktop GUI, and Web clients use the same Core surface:

```text
ConversationClient / ConversationProxy
  -> Conversation input commands
  -> conversation.events query and subscribe
  -> OutputEvent projections
```

Clients never construct Pi, Provider, Tool executors, SQLite stores, child processes, or Subagent managers. Local applications inject a local Transport; remote or browser applications inject an API/WebSocket Transport. Replay reads Journal Events without activating a Runtime.

The client operation matrix is intentionally small:

| Client surface | Transport boundary | Read path | Write path |
| --- | --- | --- | --- |
| CLI / TUI | injected local or remote `ApiTransport` | `getSnapshot`, `getRuntimePresence`, `events.list`, `events.subscribe` | `input.enqueue` |
| Electron GUI | `ElectronApiTransport` over Preload IPC | same Core operations | same Core operations |
| Web | HTTP request plus WebSocket subscription Transport | same Core operations | same Core operations |

Approval is Event-based across every surface: render the Approval OutputEvent,
then enqueue the corresponding decision InputEvent. No client calls a Tool
handler or Provider directly.

## Client Responsibilities

- CLI/TUI render ordered Events directly or through a local projection and send explicit InputEvents for messages, Stop, config reload, and Approval decisions.
- GUI/Web maintain view stores from catch-up-to-live Event subscriptions; reconnect first fetches durable history, then continues from the last sequence.
- Approval panels render `system.tool.approval.requested` and send an Approval InputEvent. They never call Tool implementations directly.
- Subagent panels render the five `agent.subagent.*` parent projections. Full child history is opened through the child Conversation ID or Host tree query.
- All clients show safe protocol errors and must not surface raw Provider, Tool, process, path, stderr, prompt, or credential data.

## Executable References

The first release uses executable smoke fixtures as reference examples so examples and acceptance behavior cannot drift:

| Scenario | Executable reference |
| --- | --- |
| In-memory Conversation | `core/scripts/local-conversation-integration-smoke.mjs` |
| Local persisted Conversation | `core/scripts/conversation-host-sqlite-integration-smoke.mjs` |
| Child-process Conversation | `core/scripts/runtime-host-child-integration-smoke.mjs` |
| Read-only replay | `core/scripts/conversation-event-integration-smoke.mjs` |
| Event-based Approval | `core/scripts/tool-approval-events-smoke.mjs` |
| One-shot Nudge | `core/scripts/runtime-pi-nudge-overlay-integration-smoke.mjs` |
| Context Compaction | `core/scripts/runtime-context-compaction-manager-smoke.mjs` |
| Subagent | `core/scripts/runtime-subagent-host-sqlite-integration-smoke.mjs` |
| Client parity | `core/scripts/runtime-client-adaptation-smoke.mjs` |

Run one reference with `node core/scripts/<name>.mjs` after `pnpm --dir core build`, or run the complete release suite described in `docs/runtime-validation-matrix.md`.

For the unified Core smoke report, run:

```bash
pnpm --dir core smoke:all
```

The final report provides pass/failure rates, failed test identities, duration
distribution, Event Loop responsiveness, and per-test-process memory growth
without forwarding raw child output.

For a complete simulated Conversation workflow, run:

```bash
pnpm --dir core smoke:runtime-conversation-complete
```

This combines the Input/Output, Context, Nudge, Tool, System Prompt, Subagent,
IPC, single-process, child-process, persistence, and blocking-regression phases
behind one executable acceptance command.

## Deferred Baselines

Task 7 closes correctness and failure-boundary validation. Throughput, memory, startup latency, maximum Journal size, and multi-process load targets remain explicit future performance work; no unmeasured number is presented as a release guarantee.
