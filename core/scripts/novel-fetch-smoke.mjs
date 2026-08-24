/**
 * novel-fetch MCP server smoke test
 * spawn server 进程 → stdio 连接 → 各 action 调用验证。
 * 用法：node core/scripts/novel-fetch-smoke.mjs [--offline]
 * （--offline：仅验证参数校验与错误归一，不发起真实网络请求）
 */
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const SERVER_ENTRY = fileURLToPath(new URL("../../mcp-servers/novel-fetch/index.mjs", import.meta.url));

const OFFLINE = process.argv.includes("--offline");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER_ENTRY],
});

const client = new Client({ name: "novel-fetch-smoke", version: "0.0.1" });

/** 调用工具并打印结果（截断）；expectError=true 时断言 isError 且返回 ok */
async function call(action, params, label, expectError = false) {
  try {
    const res = await client.callTool({ name: "novel_fetch", arguments: { action, ...params } });
    const text = (res.content?.[0]?.text ?? "").toString();
    console.log(`\n=== ${label} (${action}) ===`);
    console.log(text.length > 900 ? text.slice(0, 900) + `\n…[截断，共 ${text.length} 字符]` : text);
    const ok = expectError ? res.isError === true : !res.isError;
    if (expectError && !ok) console.log("  ⚠ 预期报错但未报错");
    return { ok, len: text.length };
  } catch (err) {
    console.log(`\n=== ${label} (${action}) ===`);
    console.log("调用失败:", err.message);
    return { ok: expectError, len: 0 };
  }
}

const results = [];
try {
  await client.connect(transport);
  console.log("✅ connected");

  const tools = await client.listTools();
  console.log("tools:", tools.tools.map((t) => t.name).join(", "));
  const target = tools.tools.find((t) => t.name === "novel_fetch");
  if (!target) throw new Error("novel_fetch 未注册");

  if (OFFLINE) {
    results.push(await call("rank", {}, "缺 rank_type（应报错）", true));
    results.push(await call("chapter", { url: "https://example.com/x" }, "非起点域名（应拒绝）", true));
    results.push(await call("book", {}, "缺 book_id（应报错）", true));
  } else {
    results.push(await call("rank", { rank_type: "yuepiao" }, "月票榜"));
    results.push(await call("book", { book_id: "1041637443" }, "书详情（捞尸人）"));
    results.push(await call("search", { kw: "诡秘之主" }, "搜索"));
    results.push(await call("author", { author: "https://m.qidian.com/author/3780268" }, "作者作品（URL 入参）"));
    results.push(
      await call("chapter", { url: "https://m.qidian.com/book/1041637443/924064845" }, "章节分片（VIP 试读）"),
    );
    results.push(await call("rank", { rank_type: "unknown" }, "未知榜单（应报错）", true));
    results.push(await call("book", {}, "缺 book_id（应报错）", true));
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n--- 结果：${passed}/${results.length} 通过 ---`);
  process.exitCode = passed === results.length ? 0 : 1;
} finally {
  await client.close().catch(() => {});
  transport.close?.();
}
