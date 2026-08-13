/**
 * 最小 renderer 脚本（browser 环境）：wrap → NovelApiClient 门面 → 对话列表/时间线/novel 总览。
 * 只 import kkrpc（browser 版）+ @novel/core/client（browser-safe，无 pino/zeromq）。
 * 事件经 ConversationProjection 消费 handle.events()（kkrpc 流式 remote ref），不再走 webContents push。
 */
import { wrap } from "kkrpc";
import { electronIpcTransport } from "kkrpc/electron";
import { ConversationProjection, type NovelApiClient } from "@novel/core/client";

declare global {
  interface Window {
    novelApi: { bridge: unknown };
  }
}

const bridge = (window.novelApi as { bridge?: unknown } | undefined)?.bridge;
if (!bridge) {
  throw new Error("window.novelApi.bridge 未暴露（preload 未生效？）");
}
const transport = electronIpcTransport({ endpoint: bridge as never, channel: "novel-rpc" });
const api = wrap<NovelApiClient>(transport);

type OpenedHandle = Awaited<ReturnType<NovelApiClient["conversations"]["open"]>>;
let activeHandle: OpenedHandle | undefined;
let activeProjection: ConversationProjection | undefined;

const listEl = document.getElementById("conversations")!;
const messagesEl = document.getElementById("messages")!;
const novelEl = document.getElementById("novel")!;
const inputEl = document.getElementById("text") as HTMLInputElement;
const sendBtn = document.getElementById("send")!;
const newBtn = document.getElementById("new")!;

function appendMessage(cls: string, text: string): void {
  const div = document.createElement("div");
  div.className = cls;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderTimeline(): void {
  if (!activeProjection) return;
  messagesEl.textContent = "";
  for (const item of activeProjection.getSnapshot().timeline) {
    appendMessage(item.kind, item.text + (item.streaming ? "…" : ""));
  }
}

async function refreshList(): Promise<void> {
  const list = await api.conversations.list();
  listEl.textContent = "";
  for (const s of list) {
    const btn = document.createElement("button");
    btn.textContent = s.name || s.conversationId;
    btn.onclick = () => void openConversation(s.conversationId);
    listEl.appendChild(btn);
  }
}

async function openConversation(id: string): Promise<void> {
  void activeProjection?.stop();
  const handle = await api.conversations.open(id);
  activeHandle = handle;
  activeProjection = new ConversationProjection(handle, id);
  activeProjection.subscribe(renderTimeline);
  await activeProjection.start();
  renderTimeline();
}

async function refreshNovel(): Promise<void> {
  const overview = await api.novel.overview.get();
  novelEl.textContent = `小说「${overview.title}」：角色 ${overview.counts.characters} · 地点 ${overview.counts.locations} · 段落 ${overview.counts.paragraphs}`;
}

async function send(): Promise<void> {
  const text = inputEl.value.trim();
  if (!text || !activeHandle) return;
  inputEl.value = "";
  await activeHandle.sendUserMessage({ text });
}

newBtn.onclick = () => {
  void api.conversations.create().then(() => refreshList());
};
sendBtn.onclick = () => void send();
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void send();
});

void refreshList();
void refreshNovel();
