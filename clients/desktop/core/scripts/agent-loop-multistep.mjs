// 多步骤复杂任务 smoke：链式调用多工具（remember → list_notes → write_scene），生成 ProviderCall debug（jsonl + html）
// 运行：node core/scripts/agent-loop-multistep.mjs（需 build，且设置 ANTHROPIC_AUTH_TOKEN）

import {
  AgentLoop,
  ProviderCallDebugger,
  createProvider,
} from "../dist/index.js";

// ── 能力直构（AgentCapability：system 分段 + 工具定义）──
const notes = [];
const toolDefs = [
  {
    name: "remember",
    version: "1",
    description: "记录一条创作笔记（人物设定/情节），存入笔记库",
    parameters: {
      type: "object",
      properties: { note: { type: "string" } },
      required: ["note"],
    },
    handler: {
      execute: async (call) => {
        const a = JSON.parse(call.args);
        notes.push(a.note);
        return `已记录：${a.note}`;
      },
    },
  },
  {
    name: "list_notes",
    version: "1",
    description: "查看当前笔记库里的所有笔记",
    parameters: { type: "object", properties: {} },
    handler: {
      execute: async () => (notes.length ? `当前笔记：${notes.join("；")}` : "（笔记库为空）"),
    },
  },
  {
    name: "write_scene",
    version: "1",
    description: "写一个场景段落（完成后任务结束）",
    parameters: {
      type: "object",
      properties: { scene: { type: "string", description: "场景主题" } },
      required: ["scene"],
    },
    handler: {
      execute: async (call) => {
        const a = JSON.parse(call.args);
        return `[场景完成] ${a.scene}`;
      },
    },
  },
];
const capability = {
  systemSections: [
    {
      kind: "static",
      id: "writer.base",
      version: "1.0.0",
      label: "Writer Base",
      render: () =>
        "你是小说创作助手。严格按用户要求逐步完成：先记录设定，再查看笔记，最后写场景。每个步骤使用对应工具。",
    },
  ],
  toolDefs,
  compactPolicies: [],
  nudgePolicies: [],
};

const dispatcher = {
  resolve: (name) => capability.toolDefs.find((x) => x.name === name),
  dispatch: async (ctx, call) => {
    const t = dispatcher.resolve(call.name);
    return t ? t.handler.execute(call) : `未知工具 ${call.name}`;
  },
};

const provider = createProvider({
  id: "deepseek",
  type: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
});
const callDebugger = new ProviderCallDebugger({
  enabled: true,
  dir: "debug/main/agent-writer",
});
const loop = new AgentLoop({
  workspace: ".",
  provider,
  agentCapability: capability,
  toolDispatcher: dispatcher,
  debugger: callDebugger,
});

console.log("=== 多步骤复杂任务 ===");
const r = await loop.run(
  "完成一个多步骤任务：1) 用 remember 记录'主角林默，剑客'；2) 用 list_notes 查看当前笔记；3) 用 write_scene 写一个深秋开场场景。逐步完成，最后一步完成后任务结束。",
  { sampling: { model: "deepseek-v4-flash", maxTokens: 1024, thinking: "high" } },
  (e) => {
    if (e.type === "text-delta") process.stdout.write(e.text);
  },
);
console.log("\nfinal:", r.final.content.slice(0, 120));
callDebugger.close();
