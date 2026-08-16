# VerifyPlanExecutionTool

- **工具名**: `VerifyPlanExecution`（userFacingName: `VerifyPlan`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/VerifyPlanExecutionTool/`
- **门槛**: `process.env.CLAUDE_CODE_VERIFY_PLAN === 'true'`
- **性质**: 只读（isReadOnly: true）、并发安全（isConcurrencySafe: true）

## 描述（模型侧 desc）

来源：`VerifyPlanExecutionTool.ts` 内联。`description()` 返回：

```text
Verify that a plan was executed correctly before exiting plan mode
```

`prompt()` 返回：

```text
Verify that a plan has been executed correctly. Call this tool before exiting plan mode to confirm all steps were completed.

Guidelines:
- Summarize the plan that was executed
- Note whether all steps completed successfully
- Include any verification notes (tests passed, files created, etc.)
- If steps were skipped or failed, explain why in verification_notes
```

## Input Schema

- `plan_summary` (string, 必填): "A summary of the plan that was executed."
- `verification_notes` (string, 可选): "Notes on what was verified and any issues found during verification."
- `all_steps_completed` (boolean, 必填): "Whether all planned steps were completed successfully."
