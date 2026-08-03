# Agent Manifest Architecture

An `AgentManifest` is the immutable assembly record used to resume an Agent
without resolving mutable `latest` definitions again. It is a Core value object,
not a Provider or SQLite adapter.

## Assembly

```text
AgentDefinition
    -> SystemPromptBuilder
        -> CompiledSystemPrompt
            -> ResolvedPromptRecipe
    -> PromptCapabilitySnapshot
        -> Tool Name + Version snapshot
    -> AgentManifestResolver
        -> AgentManifest
            -> AgentManifestStore
```

`AgentManifestResolver` resolves every Prompt Section through the frozen
`PromptSectionRegistry`. A recipe item without an explicit version becomes an
exact `ResolvedPromptSectionItem` version in the Manifest. Resume therefore
uses the recorded version and never reinterprets `latest`.

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

SQLite persistence is intentionally deferred to a Node adapter. Provider/Pi
assembly, Conversation integration, Novel Tools, Subagents, and Agent Teams are
outside this foundation step.
