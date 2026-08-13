/**
 * 最小 renderer 脚本（browser 环境，esbuild bundle）：wrap → ConversationHandle → 对话。
 * 不 import @novel/core（node 依赖），直接 import kkrpc（browser 版）。
 */
import { wrap } from "kkrpc";
import { electronIpcTransport } from "kkrpc/electron";

declare global {
  interface Window {
    novelApi: { bridge: unknown };
  }
}

const bridge = window.novelApi.bridge;
const transport = electronIpcTransport({ endpoint: bridge as never, channel: "novel-rpc" });
const handle = wrap(transport) as {
  sendUserMessage(msg: { text: string }): Promise<unknown>;
  events(): AsyncIterable<{
    type: string;
    text?: string;
  }>;
};

const messages = document.getElementById("messages")!;
const input = document.getElementById("text") as HTMLInputElement;
const sendBtn = document.getElementById("send")!;

function append(cls: string, text: string): void {
  const div = document.createElement("div");
  div.className = cls;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

// 订阅输出事件（流式 delta）
void (async () => {
  for await (const evt of handle.events()) {
    if (evt.type === "user.message" && evt.text) append("user", "👤 " + evt.text);
    else if (evt.type === "assistant.delta" && evt.text) append("assistant", evt.text);
  }
})();

async function send(): Promise<void> {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await handle.sendUserMessage({ text });
}

sendBtn.addEventListener("click", () => void send());
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void send();
});
