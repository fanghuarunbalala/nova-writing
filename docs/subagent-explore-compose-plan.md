# Read-only Explore / Compose Subagents — Implementation Plan

## 1. Status and Objective

This record captures the accepted direction and implementation shape for the
read-only `novel_explorer` / `novel_compose` subagent Agent types that were
reserved in the Novel Compose Mode plan (the "Explore / Compose subagent"
section). It supersedes the reservation and records how the two Agent types are
wired into the production desktop runtime.

Implemented on branch `feat/explore-compose-subagents` (merged into `main`).
Three previously-deferred concerns — per-agent model differentiation,
cross-process Electron smoke coverage, and runtime presence probing — remain
out of scope and are listed in §7.

## 2. Decisions

| Item | Decision |
|---|---|
| Wiring | Full production wiring: definitions + delegation + execution tools + child composition + narrow RPC |
| Read-only expression | `groupIds` (5 read groups + `runtime.todo`) + `deny` (13 Write/Edit/Delete tools) |
| Novel delegation | `novel` 1.3.0 allows `novel_explorer` / `novel_compose` via `delegation: { mode: "subagent" }` |
| Nested delegation | Disabled — subagents cannot spawn subagents (`mode: "disabled"`) |
| Host reuse | Child process opens `core.sqlite` directly; reuses `SqliteWorkspaceStore` + `SqliteSubagentBindingStore` |
| Narrow RPC | Only 3 methods added to the parent: `subagent.ensureActive` / `subagent.shutdownRuntime` / `subagent.enqueue` |
| Reused parent hosts | `ManagedConversationHost` (`ensureActive` / `shutdownRuntime`) + `StorageConversationCommandService` (`enqueue`) |
| Tool policy IDs | `toolPolicy:novel` / `toolPolicy:novel_explorer` / `toolPolicy:novel_compose` |
| Prompt differentiation | Subagent role is distinguished purely by the subagent prompt, per the original §9 reservation |

## 3. Agent Definitions

### 3.1 `novel_explorer` / `novel_compose` (1.0.0)

Both are structurally identical except for `agentType` and label:

```ts
new AgentDefinition({
  agentType: "novel_explorer" /* or "novel_compose" */,
  definitionVersion: "1.0.0",
  tools: new AgentToolPolicy({
    groupIds: [
      "runtime.todo",
      "novel.outline",
      "novel.characters",
      "novel.locations",
      "novel.paragraph",
      "novel.publication",
    ],
    deny: [
      "NovelOutlineWrite", "NovelOutlineEdit",
      "NovelCharacterWrite", "NovelCharacterEdit",
      "NovelLocationWrite", "NovelLocationEdit",
      "NovelParagraphWrite", "NovelParagraphEdit",
      "NovelVolumeWrite", "NovelVolumeEdit",
      "NovelChapterWrite", "NovelChapterEdit",
      "NovelDelete",
    ],
  }),
  delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
  communication: new AgentCommunicationPolicy("ephemeral_subagent"),
  runtimePolicyId: "default",
})
```

The effective tool view is exactly 7 tools:

```text
TodoWrite, NovelOutlineRead, NovelCharacterRead, NovelLocationRead,
NovelParagraphRead, NovelVolumeRead, NovelChapterRead
```

The `deny` list is only valid because every denied tool exists in the child's
base registry — `ToolRegistryView` rejects a `deny` entry for an unknown tool.

### 3.2 `novel` 1.3.0

The parent agent definition was bumped from 1.2.x to 1.3.0 and:

- adds `runtime.subagent` to `groupIds` (exposes `Agent`, `TaskOutput`, `TaskStop`);
- sets `delegation: { mode: "subagent", allowedAgentTypes: ["novel_explorer", "novel_compose"] }`.

## 4. Tool Policy Catalog and Execution Tools

`core/src/runtime/subagent/ProductionSubagentComposition.ts`:

- `NOVEL_AGENT_TOOL_POLICY_ID = "toolPolicy:novel"`
- `NOVEL_EXPLORER_TOOL_POLICY_ID = "toolPolicy:novel_explorer"`
- `NOVEL_COMPOSE_TOOL_POLICY_ID = "toolPolicy:novel_compose"`
- `NOVEL_SUBAGENT_DEFINITIONS` — the two `SubagentDefinition` entries (with
  `toolPolicyId`, label, description);
- `NOVEL_SUBAGENT_TOOL_COMPOSITION_POLICY` — `allowedAgentTypes` for both types
  plus the prompt/artifact/result byte limits;
- `createProductionSubagentDefinitionCatalog()` — the production catalog.

The Agent / TaskOutput / TaskStop tools come from `createAgentExecutionToolRegistry`
(`core/src/tools/subagent/index.ts`). The group `runtime.subagent`
(`SUBAGENT_TOOL_GROUP_MANIFEST`) is registered alongside `runtime.todo` and the
six novel groups so `ToolRegistryView` can resolve the novel 1.3.0 policy.

## 5. Wiring Shape

### 5.1 Process architecture

The Novel conversation runs in a child Runtime process (existing
child-runtime placement). The subagent manager needs three capabilities that
live on the parent: host activation, host shutdown, and input enqueue. Instead
of duplicating those systems, the child opens `core.sqlite` directly and calls
back to the parent over a deliberately narrow RPC surface.

```text
+---------------------------+              +--------------------------------+
| parent (NodeConversation  |   subagent.  | child runtime process          |
| ApiApplication)           |   ensureActive|  DesktopRuntimeChildComposition|
|  ManagedConversationHost  |<------------->|  Factory                        |
|  StorageConversationCmdSv |   subagent.   |   ChildRuntimeSubagentClient    |
|  DesktopRuntimeChildSub-  |   shutdown    |    -> AgentAssembler            |
|   agentProvider           |   subagent.   |    -> CatalogHostChildConversa- |
|                           |   enqueue     |      tionAdapter                |
|                           |-------------->|    -> DurableChildConversation- |
+---------------------------+              |      Manager                    |
                                           |    -> AgentExecutionToolRegistry |
                                           |    -> AgentAssemblyRestorer      |
                                           +--------------------------------+
```

Both processes open the same `core.sqlite` (WAL, `busy_timeout=5000`); the
parent `ensureActive` reads the child-created conversation row back through the
conversation catalog.

### 5.2 Child composition chain (Step 9)

`DesktopRuntimeChildCompositionFactory.#createOnce` builds, after the existing
novel tool composition:

```text
ChildRuntimeSubagentClient({ requester })                 // 3-method host+commandService
  -> createChildSubagentScopeReaders(bootstrap)            // parent scope + tool-policy relation
  -> AgentAssembler(registry/groups = base novel registry,
        manifestIdFactory -> `manifest:subagent:${agentType}:${definitionVersion}`,
        manifestStore: store.agentManifests)
  -> CatalogHostChildConversationAdapter({
        catalog: store.conversations,
        host: subagentClient.host,                          // Pick<ensureActive|shutdownRuntime>
        agentDefinitions: [novel, novel_explorer, novel_compose],
        agentAssembler,
        commandService: subagentClient.commandService,
        idFactory: ChildConversationIdFactory })
  -> DurableChildConversationManager(DefaultChildConversationManager(...),
        store.createSubagentBindingStore())
  -> SubagentTaskQueryService({ bindings, runtimePresence, finalAssistantMessages, limits })
  -> createAgentExecutionToolRegistry({ definitions, policy, manager, bindings, query, cancellation })
  -> finalRegistry = ToolRegistry([...novelTools.registry.list(), ...subagentTools.list()])
     finalGroups  = ToolGroupCatalog([...baseGroups, SUBAGENT_TOOL_GROUP_MANIFEST])
```

`AgentAssemblyRestorer` uses the final registry/groups so a restored novel
1.3.0 manifest (which includes the `runtime.subagent` group) can resolve the
Agent/TaskOutput/TaskStop tools at runtime. The subagent child manifests never
reference `runtime.subagent` (their delegation is disabled), so there is no
cyclic dependency.

### 5.3 Scope readers and presence

- `SubagentParentScopeReader` — workspace from bootstrap, depth `0`,
  `toolPolicyId = NOVEL_AGENT_TOOL_POLICY_ID`.
- `SubagentToolPolicyRelationReader` — child policy ∈ {explorer, compose} →
  `"reduced"`; identical → `"same"`; otherwise → `"unknown"`.
- Runtime presence is derived locally from the binding store
  (`creating|running` → `"online"`, else `"offline"`), not from a live host
  probe. Documented limitation, see §7.
- The final-assistant-message reader walks `persistence.messages.list` for the
  last assistant message and concatenates its `type === "text"` content parts.

### 5.4 Narrow RPC protocol

`core/src/runtime/ipc/subagent/` mirrors the persistence RPC layout:

| Method | Request | Response |
|---|---|---|
| `subagent.ensureActive` | `{ conversationId }` | activation result (`status` + `presence`) |
| `subagent.shutdownRuntime` | `{ conversationId, reason }` | shutdown result |
| `subagent.enqueue` | `{ conversationId, taskId, requesterConversationId, prompt, artifactReferences }` | enqueue receipt |

The parent handler (`ParentRuntimeSubagentHandler`) is a
`RuntimeIpcRequestHandler` + `RuntimeIpcRequestErrorMapper`. `enqueue` rebuilds
a `TaskAssignedInputEvent` (`id` = `task-assigned-${taskId}`,
`correlationId` = requesterConversationId, `causationId` = taskId) and forwards
it to the existing `StorageConversationCommandService`. Any method outside the
three-method allowlist is rejected at the parent boundary.

### 5.5 Parent endpoint wiring

- `DesktopRuntimeChildEndpointFactory` gains `DesktopRuntimeChildSubagent
  {host, commandService}`, `DesktopRuntimeChildSubagentProvider`, and an
  optional `subagentProvider` option. `connect()` builds the subagent handler
  and a composite request handler/error mapper that routes `subagent.*` to the
  subagent handler and everything else to the persistence handler.
- `ChildProcessConversationRuntimePlacement` threads the `subagentProvider`
  through to the endpoint factory.
- `NodeConversationApiApplication` exposes `getRuntimeSubagent(conversationId)`
  returning `{ host: this.host, commandService: this.commands }` — reusing the
  existing `ManagedConversationHost` and `StorageConversationCommandService`
  instances.
- `gui/src/main/runtime/DesktopRuntimePlacement.ts` implements
  `getRuntimeSubagent` on the application provider and passes a
  `subagentProvider` into `createChildProcessConversationRuntimePlacement`.

### 5.6 Child store support

`SqliteWorkspaceStore` gained `createSubagentBindingStore()` returning a
`SqliteSubagentBindingStore` over the same database. The child entrypoint's
`manifestStoreProvider` option was widened to a full
`ChildRuntimeWorkspaceStoreProvider` returning the whole workspace store
(`agentManifests` + `conversations` + `createSubagentBindingStore`).

## 6. Exports and Logging Discipline

New exports flow through: `runtime/ipc/index.ts`, `runtime/subagent/index.ts`,
`node/runtime/subagent/index.ts`, `agent/definitions/index.ts`,
`tools/subagent/index.ts`. New public classes and functions carry bilingual
JSDoc (中文 + English). Public Core boundaries stay provider-neutral — SQLite
paths, Node specifics, and store locations never leak into `@novel/core`.

Logs record only stable event codes and counts. Event payloads, novel text,
prompts, configuration content, tool data, credentials, store paths, JSONL
lines, raw error messages, stack traces, and causes are never logged.

## 7. Deferred Items

1. **Per-agent model differentiation** — the original §9 reservation limited
   differentiation to the subagent prompt. The Pi runtime resolves the model
   per conversation's model profile, not per agent definition, so assigning
   Explore/Compose a cheaper model would require a model-profile hook keyed on
   agent type. Mechanism and feasibility are understood; implementation is
   deferred.
2. **Cross-process Electron smoke** — this track validates the wiring with
   in-process child-runtime smokes (mirroring the existing subagent smokes).
   A real parent→child Electron integration test is deferred.
3. **Live runtime presence probing** — TaskOutput presence is derived from the
   local binding store rather than a live host probe. Acceptable for v1; noted
   here so a future revision can query the parent host.

## 8. Validation

| Smoke | Scope |
|---|---|
| `smoke:novel-explorer-compose-definitions` | 3 definitions; novel 1.3.0 view includes Agent/TaskOutput/TaskStop + novel tools; explorer/compose view == exactly the 7 read-only tools |
| `smoke:runtime-subagent-narrow-rpc` | `ParentRuntimeSubagentHandler` + `ChildRuntimeSubagentClient` round-trip for all 3 methods; non-allowlisted method rejected |
| `smoke:runtime-subagent-explore-compose-host-sqlite` | Spawn `novel_explorer` from a novel parent over SQLite; manifest id `manifest:subagent:novel_explorer:1.0.0`; binding completes |
| `smoke:runtime-subagent-host-sqlite` | Existing — assembler updated to the production composition so the novel 1.3.0 `runtime.subagent` group resolves |
| `smoke:novel-conversation-manifest-composition` | Existing — registry count updated to include the 3 subagent tools |

Core `pnpm check` (tsc --noEmit) and `pnpm build` are green; the GUI `pnpm
check` and the `smoke:electron-workspace-runtime-placement` GUI smoke are green
after building the `ui` package.
