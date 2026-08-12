// AgentLoop 完整案例 smoke：纯文本 / 工具调用 / 多轮延续（deepseek-v4-flash）
// 运行：node core/scripts/agent-loop-smoke.mjs（需 build，且设置 ANTHROPIC_AUTH_TOKEN）

import {
  AgentLoop,
  InMemoryRegistry,
  ProviderCallDebugger,
  createProvider,
} from "../dist/index.js";

// ── Registry 组装能力 ──
const registry = new InMemoryRegistry();
registry.registerAgent({
  agentType: "writer",
  agentVersion: "1",
  toolNames: ["remember"],
  promptIds: ["writer-base"],
});
registry.registerTool({
  name: "remember",
  version: "1",
  description: "记录一条创作笔记（人物设定/情节要点），供后续引用",
  parameters: {
    type: "object",
    properties: { note: { type: "string", description: "要记录的笔记内容" } },
    required: ["note"],
  },
  handler: {
    execute: async (call) => {
      const args = JSON.parse(call.args);
      console.log(`  [tool remember] 已记录: ${args.note}`);
      return `已记录笔记：${args.note}`;
    },
  },
});
registry.registerPrompt(
  {
    kind: "static",
    render: () =>
      "你是小说创作助手。当用户要求你记住某个设定/笔记时，务必调用 remember 工具记录。",
  },
  "writer-base",
  "1",
);
const capability = registry.buildCapability("writer", "1");

// ── ToolDispatcher（按 name 分发到 handler）──
const dispatcher = {
  dispatch: async (ctx, call) => {
    const tool = capability.toolDefs.find((t) => t.name === call.name);
    if (!tool) return `未找到工具 ${call.name}`;
    return tool.handler.execute(call);
  },
};

// ── Provider + AgentLoop（同一个 loop 实例，多轮共享 LoopContext）──
const provider = createProvider({
  id: "deepseek",
  type: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
});
// debug 模式：记录 ProviderCall（jsonl + html），目录按 conversation/agent 区分
const callDebugger = process.env.DEBUG
  ? new ProviderCallDebugger({ enabled: true, dir: "debug/main/agent-writer" })
  : undefined;

const loop = new AgentLoop({
  workspace: ".",
  provider,
  agentCapability: capability,
  toolDispatcher: dispatcher,
  debugger: callDebugger,
});

const sampling = { model: "deepseek-v4-flash", maxTokens: 512, thinking: "high" };

// ── 案例 1：纯文本 ──
console.log("=== 案例1: 纯文本 ===");
let r = await loop.run("写一句关于深秋的开头。", { sampling }, (d) => {
  if (d.type === "text-delta") process.stdout.write(d.text);
});
console.log("\nfinishReason:", r.final.content.slice(0, 30));

// ── 案例 2：工具调用（要求记住设定）──
console.log("\n=== 案例2: 工具调用 ===");
r = await loop.run("请用 remember 工具记录：主角叫林默，剑客。", { sampling });
console.log("final:", r.final.content.slice(0, 60));

// ── 案例 3：多轮延续（引用之前记录的设定）──
console.log("\n=== 案例3: 多轮延续 ===");
r = await loop.run("刚才记录的主角叫什么？", { sampling });
console.log("final:", r.final.content.slice(0, 60));

// 关闭 debugger（渲染 html）
callDebugger?.close();
