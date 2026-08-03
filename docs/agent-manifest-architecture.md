# Agent Manifest Architecture

An `AgentManifest` is the immutable assembly record used to resume an Agent
without resolving mutable `latest` definitions again. It is a Core value object,
not a Provider or SQLite adapter.

## Assembly

```text
AgentDefinition
    -> AgentAssembler
        -> ToolRegistryView
        -> PromptCapabilitySnapshot
        -> AgentManifestResolver
            -> AgentManifest
                -> AgentManifestStore
        -> AgentAssembly
```

`AgentManifestResolver` resolves every Prompt Section through the frozen
`PromptSectionRegistry`. A recipe item without an explicit version becomes an
exact `ResolvedPromptSectionItem` version in the Manifest. Resume therefore
uses the recorded version and never reinterprets `latest`.

`AgentAssembler` is the Core composition boundary. It applies the Definition's
Tool Group, allow, and deny policy to the immutable `ToolRegistryView`, derives
Prompt capability metadata from the resulting View, asks the Resolver to create
the Manifest, persists it through the asynchronous Store Port, and returns an
`AgentAssembly`. The returned object exposes only the frozen Manifest and Tool
View needed by a Conversation Runtime; execution remains a later Runtime
responsibility.

The next Runtime boundary is `AgentRuntimeConfiguration`, documented in
`docs/agent-runtime-configuration.md`. It adds Conversation identity, policy
references, and explicit execution limits without placing mutable Runtime
state or Provider objects inside the Agent Manifest.

The Manifest stores:

- the full `AgentDefinition` snapshot;
- the resolved Prompt recipe and compiled Base Prompt digest;
- sorted, unique Tool Name + Version capabilities;
- delegation mode, allowed Agent types, communication role, and Runtime policy;
- a stable Manifest ID, creation timestamp, and SHA-256 Manifest digest.

Prompt content is retained as part of the immutable Manifest snapshot for
reproducible Provider assembly. Resolver logs contain only stable identity and
count/digest metadata; they never log Prompt content or Tool data.

## Storage Boundary

`AgentManifestStore` is asynchronous. The current Core implementation is
`InMemoryAgentManifestStore`, which is deterministic and conflict-safe:

- saving the same ID and digest is idempotent;
- saving the same ID with a different digest fails with `manifest_conflict`;
- lookup by Agent identity is sorted by creation time and then Manifest ID.

The Node adapter is `SqliteAgentManifestStore`, exposed through
`SqliteWorkspaceStore.agentManifests`. It stores the immutable JSON snapshot
inside a versioned SQLite table, hydrates class/value objects on reads, and
uses one immediate transaction for idempotent saves and Digest conflict
checks. Provider/Pi execution, Novel Tools, Subagents, and Agent Teams remain
outside the Manifest Store boundary.
