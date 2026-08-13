/**
 * 最小 renderer 脚本（browser 环境，esbuild bundle）：wrap → ConversationHandle → 对话。
 * 事件经 preload 的 onEvent 订阅（main 侧 webContents.send 推送），unary 方法经 kkrpc bridge。
 */
import { wrap } from "kkrpc";
import { electronIpcTransport } from "kkrpc/electron";

declare global {
  interface Window {
    novelApi: {
      bridge: unknown;
      onEvent: (callback: (evt: { type: string; text?: string }) => void) => () => void;
    };
  }
}

// 错误诊断：捕获 renderer 报错，显示在页面上
window.addEventListener("error", (e) => {
  const errDiv = document.createElement("div");
  errDiv.style.color = "red";
  errDiv.textContent = "[renderer error] " + e.message;
  document.body.appendChild(errDiv);
});

const bridge = (window.novelApi as { bridge?: unknown } | undefined)?.bridge;
if (!bridge) {
  throw new Error("window.novelApi.bridge 未暴露（preload 未生效？）");
}
const transport = electronIpcTransport({ endpoint: bridge as never, channel: "novel-rpc" });
const handle = wrap(transport) as {
  sendUserMessage(msg: { text: string }): Promise<unknown>;
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

// 订阅事件（main 侧推送）
window.novelApi.onEvent((evt) => {
  if (evt.type === "user.message" && evt.text) append("user", "👤 " + evt.text);
  else if (evt.type === "assistant.delta" && evt.text) append("assistant", evt.text);
});

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
