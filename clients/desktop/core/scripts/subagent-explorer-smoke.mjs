// subagent 进程内派发 smoke：main 经 Agent 工具派 Explore → TaskOutput 收结果 → store 未变更（只读证明）
// 运行：node core/scripts/subagent-explorer-smoke.mjs（需 build，且设置 ANTHROPIC_AUTH_TOKEN）

import {
  buildNovelAgent,
  buildNovelExplorerAgent,
  createProvider,
  Conversation,
  InMemoryConversationTodoStore,
  InMemoryNovelStore,
  SubagentRuntime,
} from "../dist/index.js";

// 内存 novel store：播种 2 个角色（只读证明基准）
const store = new InMemoryNovelStore();
await store.mutate({ op: "character.create", input: { name: "林默", summary: "剑客主角" } });
await store.mutate({ op: "character.create", input: { name: "苏晚晴", summary: "医女" } });
const handle = {
  query: (q) => store.query(q),
  mutate: (m) => store.mutate(m),
};

const providerConfig = {
  type: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
};

const todoStore = new InMemoryConversationTodoStore();
const sampling = { model: "deepseek-v4-flash", maxTokens: 512, thinking: "high" };
const conversationId = "smoke-c1";

const subagentRuntime = new SubagentRuntime({
  sampling,
  builders: {
    Explore: (agentId) =>
      buildNovelExplorerAgent({
        workspace: ".",
        provider: createProvider({ id: "explorer", ...providerConfig }),
        handle,
        todoStore,
        conversationId,
        agentId,
      }),
  },
});

const loop = buildNovelAgent({
  workspace: ".",
  provider: createProvider({ id: "main", ...providerConfig }),
  handle,
  subagent: { spawner: subagentRuntime },
});

const conversation = new Conversation({ conversationId, loop, sampling, subagentRuntime });

// 打印全部非 delta 事件（agentId 可见 subagent 事件）
await conversation.subscribeEvents((e) => {
  if (e.type !== "assistant.delta") {
    console.log(`[evt] ${e.type} agentId=${e.agentId ?? "-"}${e.name ? ` tool=${e.name}` : ""}`);
  }
});

console.log("=== subagent 进程内派发 smoke ===");
const r = await loop.run(
  "用 Agent 工具派发一个 Explore 子代理，任务是列出当前小说的全部角色名字。然后等它完成（TaskOutput block:true），最后用一句话汇总角色名单。",
  { sampling, maxTurns: 8 },
);
console.log("\nfinal:", r.final.content);

// 只读证明：store 未变更（角色数仍为播种数）
const chars = await store.query({ op: "characters.list" });
console.log("store 角色数:", chars.length);
if (chars.length !== 2) {
  console.error("FAIL: store 被变更（explorer 只读边界被破坏）");
  process.exit(1);
}
console.log("PASS: store 未变更（explorer 只读边界成立）");

// 结果汇总应提到播种角色（模型偶发换名只降级为 WARN，不判失败）
for (const name of ["林默", "苏晚晴"]) {
  if (!r.final.content.includes(name)) {
    console.warn(`WARN: 汇总未提及 "${name}"（检查上方事件流 CharacterRead 是否执行）`);
  }
}
