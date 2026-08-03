# Runtime Release Validation Matrix

## Required Commands

```bash
pnpm check
pnpm --dir core smoke:all
pnpm --dir core smoke:runtime-subagent-validation
```

`smoke:all` discovers every top-level `core/scripts/*-smoke.mjs` fixture and
runs each test in an isolated process. Its unified report includes total,
passed and failed counts, pass/failure rates, wall/cumulative/average/p50/p95/
maximum durations, Event Loop delay and utilization, peak RSS/Heap growth,
the ten slowest tests, and every failed test. A machine-readable
`CORE_SMOKE_SUITE_REPORT=<json>` line is emitted after the human summary.

Individual child stdout, stderr, errors, stacks, paths, and payloads are not
forwarded. Failed entries contain only the test filename, fixed failure kind,
duration, process exit/signal state, and captured byte counts. Each test has a
30-second hard timeout; this is a deadlock guard rather than a production SLA.
RSS and Heap values measure the isolated test process and do not aggregate
memory owned by descendant processes.

`smoke:runtime-subagent-validation` runs the focused ephemeral Subagent slice
with the same report format. It covers Task protocol and assignment Events,
single-process lifecycle and recovery, process-free query and completion
bridging, dynamic `Task`/`TaskGet`/`TaskCancel` Tools, SQLite persistence,
capacity and reduced Tool policy checks, plus provider-neutral IPC and both
same-process and child-process Runtime placement. It emits a machine-readable
`SUBAGENT_VALIDATION_REPORT=<json>` line and fails on any child failure,
timeout, missing report, or non-finite performance metric.

## Acceptance Coverage

| Boundary | Required coverage |
| --- | --- |
| Types and protocol | workspace type checking, strict protocol typechecks, exact Event schemas |
| Journal and replay | append, duplicate handling, recovery, read-only replay without Runtime activation |
| Live Events | catch-up-to-live continuity, bounded subscriptions, reconnect sequence ownership |
| Host and Runtime | activation, reuse, idle/shutdown behavior, crash normalization, no automatic restart |
| Control and cancellation | Control Lane, Stop/Interrupt preemption, Tool and Subagent cancellation |
| Approval | durable request/resolution Events, restoration, no direct UI execution path |
| Context and Nudge | compaction, Checkpoint application, oversized Artifact references, one-shot reminder disappearance |
| Tools | registry, group manifests, allow/deny views, permission, Approval, sandbox, timeout, cancellation, trace |
| IPC | strict framing, replay, cancellation, persistence RPC, heartbeat, graceful/forced termination |
| Subagents | depth/limits, reduce-only Tool policy, result delivery, parent projection, recovery, tree observation, SQLite restart |
| Client portability | Core client/proxy/transport contracts compile for CLI, GUI, Web, and shared UI packages |

## Failure Injection

The release suite includes invalid schema data, duplicate IDs, append failure, projection failure, stale recovery state, child creation/activation/rollback failure, process crash, heartbeat loss, IPC queue pressure, cancellation races, Tool timeout/denial, and corrupted persisted projections. Logs are reviewed to remain payload-free.

Checkpoint 7 is accepted only when `pnpm check`, `pnpm --dir core smoke:all`, `git diff --check`, and scoped secret/generated-file review pass from one repository state.

## R1-R11 Release Evidence

The post-Task-7 Runtime hardening track uses the same isolated runner. On
August 3, 2026, `pnpm smoke:all` completed 165 tests with 165 passed and 0
failed. The report included pass/failure rates, wall and cumulative duration,
p50/p95/maximum duration, Event Loop lag/utilization, peak RSS/Heap growth,
slowest tests, and failed-test identities. The R7-R10 focused fixtures are
included in the complete Conversation simulation and release acceptance
references.

## Complete Conversation Simulation

`core/scripts/runtime-conversation-complete-simulation-smoke.mjs` is the
cross-component Conversation usage test. One command validates:

- InputEvent persistence/routing and OutputEvent schema/publication;
- Context Compaction, Checkpoint projection, one-shot Nudge behavior, and exact
  base System Prompt restoration;
- Tool Registry construction and complete Approval/Sandbox/Trace execution;
- Subagent lifecycle in one process and durable Host-backed scheduling;
- Runtime IPC request handling and a real Node child-process Conversation;
- Journal replay and parent/child durable projections.

Each phase runs in an isolated process. The phase process measures its own wall
duration, maximum Event Loop delay, Event Loop utilization, and peak RSS growth.
The parent applies a hard timeout and kills a blocked phase. These limits are
regression and deadlock guards, not production throughput or latency SLAs; the
formal performance baselines remain deferred as documented.
