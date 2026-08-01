# Novel Harness Execution Protocol

These instructions apply to the entire repository.

## Mission

Complete the documented Task 1 through Task 7 architecture and implementation plan. Continue from the current repository status; do not reimplement completed checkpoints.

## Autonomous Authority

- The agent may autonomously plan, implement, validate, document, and commit the next incomplete step described in `docs/implementation-plan.md`.
- The agent does not need to wait for explicit approval between documented steps.
- Autonomous authority is limited to the currently selected documented task step. Do not implement deferred features, adjacent future steps, unrelated refactors, or behavior outside that step.
- If a step depends on an unresolved architectural decision that cannot be derived safely from the accepted documents and existing code, stop and ask the user before implementation.

## Required Recovery Reading

After any context compression, context reset, resumed goal, or uncertainty about current scope, read these files again before planning or editing:

1. `AGENTS.md`
2. `docs/implementation-plan.md`
3. `docs/architecture.md`
4. Applicable nested `AGENTS.md` files
5. `git status` and recent `git log`

Do not rely only on a compressed conversation summary when repository documents can establish the current task and accepted boundaries.

## Per-Step Execution Cycle

Every implementation step must follow this order:

1. Re-read the relevant task section and accepted architecture.
2. Identify one concrete next step inside the current documented task.
3. Publish a specific plan before editing code.
4. Implement only that planned step.
5. Add or update focused validation and required documentation.
6. Run focused tests first, then the complete established validation suite.
7. Review the diff for scope, generated files, secrets, and formatting errors.
8. Commit the completed step immediately with one focused commit.
9. Report the commit and publish the next step plan before continuing.

Planning is mandatory even when the agent has authority to continue automatically. A plan is not an approval gate unless the task contains an unresolved decision.

## Scope and Quality Boundaries

- Follow the async-first hybrid architecture documented by the project.
- Preserve stable public abstractions and keep Pi, process placement, Node, and future Rust details behind their accepted boundaries.
- Do not silently resolve questions explicitly marked unresolved or deferred.
- Do not change unrelated code or repair unrelated failures.
- Important TypeScript files should include concise top-level purpose or example comments.
- Important execution paths should use structured `info` and `debug` logs.
- Logs must never expose Event payloads, novel text, prompts, configuration contents, Tool data, credentials, Store/work paths, JSONL lines, raw error messages, stacks, causes, or Runtime stderr.
- Each commit must leave the repository in a validated, reviewable state.

## Completion Boundary

The autonomous execution objective ends only when the documented Task 1 through Task 7 deliverables are implemented, validated, documented, and committed, or when progress is blocked by an unresolved decision requiring user input.
