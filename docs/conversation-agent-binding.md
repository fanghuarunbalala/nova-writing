# Conversation Agent Manifest Binding

Every new Agent-backed Conversation may persist an exact Agent Manifest
identity alongside its Agent type and Definition version:

```text
ConversationAgentBinding
├── agentType
├── definitionVersion
├── manifestId
└── manifestDigest
```

`manifestId` and `manifestDigest` are optional only for legacy Conversations
created before Agent Manifest assembly existed. New Agent assembly flows write
both fields together.

During Runtime Bootstrap, a Binding that contains `manifestId` must resolve the
same Manifest from `AgentManifestStore`. Bootstrap rejects missing Manifests,
Digest mismatches, Agent type mismatches, and Definition version mismatches. It
never resolves the latest Agent Definition as a substitute.

The SQLite Conversation binding schema stores `manifest_id` and
`manifest_digest`. Existing rows remain readable after migration. Runtime logs
record only Agent identity and stable failure codes; they never include Prompt
content or Manifest snapshots.
