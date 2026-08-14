// DeepSeek smoke：验证 provider 全链路（deepseek-v4-flash + 环境变量 key）
// 运行：node core/scripts/deepseek-smoke.mjs（需已 build core，且设置 ANTHROPIC_AUTH_TOKEN）

import { createProvider } from "../dist/index.js";

const provider = createProvider({
  id: "deepseek",
  type: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN, // 从 ANTHROPIC_AUTH_TOKEN 读
});

const result = await provider.call(
  {
    system: "你是小说创作助手",
    messages: [{ role: "user", content: "写一段小说开头，主角推开一扇门。" }],
    sampling: { model: "deepseek-v4-flash", maxTokens: 512, thinking: "high" },
  },
  (d) => {
    if (d.type === "text-delta") process.stdout.write(d.text);
  },
);

console.log("\n---");
console.log("finishReason:", result.finishReason);
console.log("usage:", result.usage);
