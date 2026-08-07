# Agent Prompt Architecture

The initial `novel_agent@1.0.0` uses the generic Prompt system. Novel-specific
Prompt Sections, Novel Tools, Subagents, and Agent Team orchestration remain
deferred.

## Runtime model

```text
AgentDefinition
    -> PromptRecipe
        -> PromptPlanItem[]
            -> PromptSectionItem / InlinePromptItem
    -> SystemPromptBuilder
        -> PromptBlock[]
            -> CompiledSystemPrompt
```

Prompt Plan Items are class/value objects inside Core. JSON objects appear only
in `toSnapshot()` results used at persistence or IPC boundaries.

## Prompt Recipe

An Agent Definition owns an ordered `PromptRecipe`. A Section Item references a
reusable Section by ID and optionally by exact version. An omitted version
resolves to the latest stable version in the frozen `PromptSectionRegistry`.
An Inline Item is intended for a short one-off instruction and is bounded to
avoid turning Agent Definitions into unstructured Prompt files.

The resolved version is recorded when an Agent Manifest is created. Resume
never resolves `latest` again; it uses the Manifest's exact Section versions.

The Manifest assembly and storage boundary is documented in
`docs/agent-manifest-architecture.md`.

## Sections and Context

Sections render against an immutable `PromptContext` containing Agent identity
and the resolved Tool capability snapshot. Generic Sections currently include:

```text
core.runtime.protocol
agent.identity
conversation.behavior
tool.guidance
todo.guidance
context.reliability
completion.contract
```

`SystemPromptBuilder` creates only the stable Base System Prompt. Dynamic
Runtime state is injected as `system.reminder` messages (`todo_reminder`,
`compact_summary`, `nudge`, `plan_constraint`, `deferred_tools_delta`) into the
Provider-call candidate by `PromptAssemblyBuilder`:

```text
Base Prompt (only)
  + canonical Messages
  + system.reminder messages
      -> PromptAssemblyBuilder
      -> one Provider-call candidate (systemPrompt + messages + digest)
```

Reminder messages are append-only and never deleted by compaction or
projection, keeping the message prefix stable for Provider prefill caches.
Checkpoint summaries, current todos, nudges, plan constraints, and deferred-tool
lists all live in the message layer instead of the System Prompt string.
Messages remain Provider message records rather than being flattened into the
System Prompt string.

## Environment block

Each provider call appends an environment block to the System Prompt before
digesting: current local date with timezone, platform, model id (when
resolvable), and the workspace working directory. `PromptAssemblyBuilder`
refreshes the block per call through an optional `EnvironmentInfoProvider`;
the rest of the base stays constant, and the block changes at most once per
day (date rollover). Model resolution failure degrades to omitting the model
line. The Node host supplies the snapshot via `NodeEnvironmentInfoProvider`,
resolving the model lazily through `EffectiveModelExecutionResolver`.

## Initial Novel Agent

`novel_agent@1.0.0` is standalone:

- Prompt uses only generic Sections plus one language Inline instruction.
- Tool policy contains only `runtime.todo` and therefore `TodoWrite`.
- Delegation is disabled.
- Novel-domain Tools and Subagent/Agent Team capabilities are not assembled.
