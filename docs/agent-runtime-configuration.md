# Agent Runtime Configuration

`AgentRuntimeConfiguration` is the immutable, provider-neutral configuration
passed to one Conversation Runtime activation. It is assembled after the
Agent Definition has been resolved into an `AgentAssembly`.

```text
Conversation ID
    + AgentAssembly
        + AgentManifest
        + Compiled Base Prompt
        + ToolRegistryView
    + Policy References
    + Execution Limits
        -> AgentRuntimeConfiguration
```

## Responsibilities

The configuration provides:

- the Conversation identity for Runtime ownership checks;
- the immutable Agent Manifest and Tool View selected for the Conversation;
- Runtime, Context, and Nudge policy identifiers;
- explicit turn, Provider-call, Tool-call, and timeout limits.

The `runtimePolicyId` must match the policy identity frozen in the Agent
Manifest. This prevents a resumed Conversation from silently switching Runtime
behavior while retaining the same Agent identity.

## Deliberate Exclusions

The configuration does not contain:

- Provider or Pi objects;
- Tool handlers or Tool arguments;
- Journal, Message, Context, or Nudge mutable state;
- process handles, IPC channels, Store paths, credentials, or workdir values;
- a Conversation execution loop.

Those dependencies are injected by the Runtime Host. The configuration is safe
to validate, snapshot, transfer across a Core boundary, and reuse for local or
child-process execution.
