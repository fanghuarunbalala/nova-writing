# WebSearchTool

- **工具名**: `WebSearch`（userFacingName: `Web Search`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/WebSearchTool/`
- **门槛**: 无条件（getAllBaseTools 直接列出）
- **性质**: 只读（isReadOnly: true）、并发安全（isConcurrencySafe: true）

## 描述（模型侧 desc）

`description(input)` 为动态模板（来源：`WebSearchTool.ts` 内联）：

```text
Claude wants to search the web for: ${input.query}
```

`prompt()` 返回 `prompt.ts` 中 `getWebSearchPrompt()` 的拼装文本（`${currentMonthYear}` 运行时由 `getLocalMonthYear()` 计算，格式 "Month YYYY"，当前为 "August 2026"）：

```text

- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - This is MANDATORY - never skip including sources in your response
  - Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US

IMPORTANT - Use the correct year in search queries:
  - The current month is August 2026. You MUST use this year when searching for recent information, documentation, or current events.
  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year
```

## Input Schema

- `query` (string, 必填, min 2): "The search query to use"
- `allowed_domains` (array<string>, 可选): "Only include search results from these domains"
- `blocked_domains` (array<string>, 可选): "Never include search results from these domains"
- `num_results` (number, 可选): "Number of search results to return (default: 8)"
- `livecrawl` (enum `fallback` | `preferred`, 可选): "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')"
- `search_type` (enum `auto` | `fast` | `deep`, 可选): "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search"
- `context_max_characters` (number, 可选): "Maximum characters for context string optimized for LLMs (default: 10000)"
