# ExitWorktreeTool

- **工具名**: `ExitWorktree`（userFacingName: `Exiting worktree`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/ExitWorktreeTool/`
- **门槛**: `isWorktreeModeEnabled()`（原为 GrowthBook flag `tengu_worktree_mode`；现实现无条件返回 `true`，与 EnterWorktreeTool 成对注册）；`shouldDefer: true`
- **性质**: isDestructive(input): `input.action === 'remove'` 时为 `true`
- **searchHint**: `'exit a worktree session and return to the original directory'`

## 描述（模型侧 desc）

`description()` 返回（内联）：

```
Exits a worktree session created by EnterWorktree and restores the original working directory
```

`prompt()` 返回 `getExitWorktreeToolPrompt()`：

```
Exit a worktree session created by EnterWorktree and return the session to the original working directory.

## Scope

This tool ONLY operates on worktrees created by EnterWorktree in this session. It will NOT touch:
- Worktrees you created manually with `git worktree add`
- Worktrees from a previous session (even if created by EnterWorktree then)
- The directory you're in if EnterWorktree was never called

If called outside an EnterWorktree session, the tool is a **no-op**: it reports that no worktree session is active and takes no action. Filesystem state is unchanged.

## When to Use

- The user explicitly asks to "exit the worktree", "leave the worktree", "go back", or otherwise end the worktree session
- Do NOT call this proactively — only when the user asks

## Parameters

- `action` (required): `"keep"` or `"remove"`
  - `"keep"` — leave the worktree directory and branch intact on disk. Use this if the user wants to come back to the work later, or if there are changes to preserve.
  - `"remove"` — delete the worktree directory and its branch. Use this for a clean exit when the work is done or abandoned.
- `discard_changes` (optional, default false): only meaningful with `action: "remove"`. If the worktree has uncommitted files or commits not on the original branch, the tool will REFUSE to remove it unless this is set to `true`. If the tool returns an error listing changes, confirm with the user before re-invoking with `discard_changes: true`.

## Behavior

- Restores the session's working directory to where it was before EnterWorktree
- Clears CWD-dependent caches (system prompt sections, memory files, plans directory) so the session state reflects the original directory
- If a tmux session was attached to the worktree: killed on `remove`, left running on `keep` (its name is returned so the user can reattach)
- Once exited, EnterWorktree can be called again to create a fresh worktree
```

## Input Schema

- `action` (enum `keep|remove`, 必填): "\"keep\" leaves the worktree and branch on disk; \"remove\" deletes both."
- `discard_changes` (boolean, 可选): "Required true when action is \"remove\" and the worktree has uncommitted files or unmerged commits. The tool will refuse and list them otherwise."
