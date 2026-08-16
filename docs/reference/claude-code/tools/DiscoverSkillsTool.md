# DiscoverSkillsTool

- **工具名**: `DiscoverSkills`（userFacingName: `Discover Skills`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/DiscoverSkillsTool/`
- **门槛**: `feature('EXPERIMENTAL_SKILL_SEARCH')`（tools.ts 中 `DiscoverSkillsTool ? [DiscoverSkillsTool] : []`，import 仅在 GrowthBook feature `EXPERIMENTAL_SKILL_SEARCH` 开启时解析）
- **性质**: isReadOnly: `true`；isConcurrencySafe: `true`；`strict: true`
- **searchHint**: `'find search discover skills commands tools capabilities'`

## 描述（模型侧 desc）

`description()` 返回 `DESCRIPTION`：

```
Search for relevant skills by describing what you want to do
```

`prompt()` 返回 `DISCOVER_SKILLS_PROMPT`：

```
Search for skills relevant to a task description. Returns matching skills ranked by relevance.

Use this when:
- The auto-surfaced skills don't cover your current task
- You're pivoting to a different kind of work mid-conversation
- You want to find specialized skills for an unusual workflow

The search uses TF-IDF keyword matching against all registered skills (bundled, user-defined, and MCP-provided). Results include skill name, description, and relevance score.
```

## Input Schema

- `description` (string, 必填): "Description of what you want to do. Be specific — e.g. \"deploy a Next.js app to Cloudflare Workers\" rather than just \"deploy\"."
- `limit` (number, 可选): "Maximum number of results to return (default: 5)"
