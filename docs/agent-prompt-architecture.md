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

## Static and dynamic prompt sections

Prompt Sections declare a `kind`: `"static"` (default) or `"dynamic"`.
`ManifestSystemPromptCompiler.compile()` renders only static sections once at
manifest provisioning and records that frozen base in the Agent Manifest
(static sections must precede dynamic ones in a recipe). At runtime,
`RuntimeSystemPromptBuilder.resolve()` composes the final System Prompt per
call by appending each dynamic section's `renderDynamic()` output to the
static base and recomputing the digest; the static prefix stays byte-identical
so provider prefix caches remain effective.

The environment block (`core.environment`, a dynamic section) is rendered per
call: date/timezone are computed at render time, while workdir/platform/model
id come from the runtime-injected input (`workdir` from the bootstrap,
platform from the host, model id lazily resolved and omitted on failure). The
block changes at most once per day (date rollover).

## Initial Novel Agent

`novel_agent@1.1.0` is standalone:

- Prompt Recipe: `core.runtime.protocol`, `novel.identity`, `novel.system`,
  then the dynamic `core.environment` section (static-first, dynamic-last).
  `novel.communication`, `novel.doing-tasks`, and `novel.actions` are
  registered but not yet wired into the Recipe.
- Tool policy: `runtime.todo` plus the novel groups
  (outline/characters/locations/paragraph/publication/delete).
- Delegation is disabled.
- Subagent/Agent Team capabilities are not assembled.
