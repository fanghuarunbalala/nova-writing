# Runtime Release Validation Matrix

## Required Commands

```bash
pnpm check
cd core
pnpm build
for script in $(find scripts -maxdepth 1 -type f -name '*-smoke.mjs' | sort); do
  node "$script"
done
```

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

Checkpoint 7 is accepted only when `pnpm check`, every Core smoke script, `git diff --check`, and scoped secret/generated-file review pass from one repository state.
