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

## Restoration

```text
ConversationRuntimeBootstrap
    -> manifestId + manifestDigest
    -> AgentManifestStore
    -> AgentAssemblyRestorer
    -> Runtime Configuration Profile
    -> AgentRuntimeConfiguration
```

`AgentAssemblyRestorer` reconstructs the Tool View from the exact Tool policy
stored in the Manifest and rejects missing or changed Tool versions. It reuses
the compiled Prompt already stored in the Manifest and never calls
`SystemPromptBuilder` or resolves a latest Prompt Section.

`AgentRuntimeConfigurationFactory` requires a manifest-bound Conversation
Bootstrap, verifies Agent type, Definition version, and Manifest digest, then
selects the Context, Nudge, Runtime, and execution-limit profile by the
Manifest's exact `runtimePolicyId`.

## Provider-neutral Execution Assembly

`AgentRuntimeExecutionAssembler` resolves two injected ports for a restored
configuration:

- `AgentRuntimeContextCompilerFactory` creates the Core Context compiler;
- `AgentRuntimeAdapterFactory` creates the concrete Provider adapter.

The resulting `AgentRuntimeExecutionAssembly` exposes the configuration, a
Manifest-backed `RuntimeSystemPromptSource`, the Context compiler, and the
provider-neutral `AgentRuntimeAdapter`. Pi remains confined to the internal Pi
adapter implementation. The execution assembler never logs Prompt content,
Provider credentials, Tool data, or mutable Runtime state.
