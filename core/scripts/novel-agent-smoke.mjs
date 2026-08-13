// Novel Agent 装配 smoke：buildNovelAgent 组装 → 真实 deepseek 跑（工具 + prompt 分节）
// 运行：node core/scripts/novel-agent-smoke.mjs（需 build，且设置 ANTHROPIC_AUTH_TOKEN）

import { buildNovelAgent, createProvider, InMemoryNovelStore } from "../dist/index.js";

// 内存 novel store（工具对接）
const store = new InMemoryNovelStore();
const handle = {
  query: (q) => store.query(q),
  mutate: (m) => store.mutate(m),
};

const provider = createProvider({
  id: "deepseek",
  type: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
});

const loop = buildNovelAgent({ workspace: ".", provider, handle });

const sampling = { model: "deepseek-v4-flash", maxTokens: 512, thinking: "high" };

console.log("=== Novel Agent 装配验证 ===");
const r = await loop.run(
  "为我的小说创建一个角色：主角叫林默，是一名剑客。用工具完成。",
  { sampling },
  (e) => {
    if (e.type === "assistant.delta") process.stdout.write(e.text ?? "");
  },
);
console.log("\nfinal:", r.final.content.slice(0, 100));

// 验证工具实际写入了 store
const chars = await store.query({ op: "characters.list" });
console.log("store 角色数:", chars.length, chars.length ? `（${chars[0].name}）` : "");
