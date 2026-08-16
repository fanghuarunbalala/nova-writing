# EnterWorktreeTool

- **工具名**: `EnterWorktree`（userFacingName: `Creating worktree`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/EnterWorktreeTool/`
- **门槛**: `isWorktreeModeEnabled()`（原为 GrowthBook flag `tengu_worktree_mode`；现实现无条件返回 `true`，与 ExitWorktreeTool 成对注册）；`shouldDefer: true`
- **searchHint**: `'create an isolated git worktree and switch into it'`

## 描述（模型侧 desc）

`description()` 返回（内联）：

```
Creates an isolated worktree (via git or configured hooks) and switches the session into it
```

`prompt()` 返回 `getEnterWorktreeToolPrompt()`：

```
Use this tool ONLY when the user explicitly asks to work in a worktree. This tool creates an isolated git worktree and switches the current session into it.

## When to Use

- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree", "use a worktree")

## When NOT to Use

- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless they specifically mention worktrees
- Never use this tool unless the user explicitly mentions "worktree"

## Requirements

- Must be in a git repository, OR have WorktreeCreate/WorktreeRemove hooks configured in settings.json
- Must not already be in a worktree

## Behavior

- In a git repository: creates a new git worktree inside `.claude/worktrees/` with a new branch based on HEAD
- Outside a git repository: delegates to WorktreeCreate/WorktreeRemove hooks for VCS-agnostic isolation
- Switches the session's working directory to the new worktree
- Use ExitWorktree to leave the worktree mid-session (keep or remove). On session exit, if still in the worktree, the user will be prompted to keep or remove it

## Parameters

- `name` (optional): A name for the worktree. If not provided, a random name is generated.
```

## Input Schema

- `name` (string, 可选, 经 `validateWorktreeSlug` superRefine 校验): "Optional name for the worktree. Each \"/\"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided."
