import type { FastifyInstance } from "fastify";
import { buildServer } from "./index.js";
import type { Db } from "./db.js";
import type { SseHub } from "./sse.js";

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  hub: SseHub;
}

export async function makeApp(): Promise<TestApp> {
  return buildServer({ secret: "test-secret" }) as Promise<TestApp>;
}

export interface Session {
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
}

export async function registerUser(app: FastifyInstance, username: string, deviceName = "测试设备"): Promise<Session> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { username, password: "password123", deviceName },
  });
  if (res.statusCode !== 201) throw new Error(`注册失败: ${res.statusCode} ${res.body}`);
  return res.json() as Session;
}

export async function loginUser(app: FastifyInstance, username: string, deviceName: string): Promise<Session> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { username, password: "password123", deviceName },
  });
  if (res.statusCode !== 200) throw new Error(`登录失败: ${res.statusCode} ${res.body}`);
  return res.json() as Session;
}

export function auth(s: Session): { authorization: string } {
  return { authorization: `Bearer ${s.accessToken}` };
}

export async function createProject(app: FastifyInstance, s: Session, name = "测试项目"): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: auth(s),
    payload: { name },
  });
  return (res.json() as { id: string }).id;
}

export async function acquireLease(app: FastifyInstance, s: Session, conversationId: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/leases",
    headers: auth(s),
    payload: { conversationId },
  });
  if (res.statusCode !== 200) throw new Error(`申请租约失败: ${res.statusCode} ${res.body}`);
  return (res.json() as { leaseToken: string }).leaseToken;
}

/** 打开持久 SSE 连接：ready 在收到首帧 ready 事件后 resolve（消除订阅竞态），手动 close。 */
export function openSse(baseUrl: string, query: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const events: any[] = [];
  let resolveReady: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  (async () => {
    try {
      const res = await fetch(`${baseUrl}/v1/events?${query}`, { headers, signal: controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              const event = JSON.parse(line.slice(6));
              events.push(event);
              if (event.type === "ready") resolveReady();
            }
          }
        }
      }
    } catch {
      /* close 或断流 */
    }
  })();
  return {
    events,
    ready: ready as Promise<void>,
    close: () => controller.abort(),
    waitFor: async (pred: (events: any[]) => boolean, timeoutMs = 5000) => {
      const start = Date.now();
      while (!pred(events)) {
        if (Date.now() - start > timeoutMs) throw new Error("SSE 等待事件超时");
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
}

/** 起真实端口并用 fetch 读 SSE，收集到满足条件或超时。 */
export async function readSse(
  baseUrl: string,
  query: string,
  headers: Record<string, string>,
  until: (events: any[]) => boolean,
  timeoutMs = 5000
): Promise<any[]> {
  const stream = openSse(baseUrl, query, headers);
  const timer = setTimeout(() => stream.close(), timeoutMs);
  try {
    await stream.waitFor(until, timeoutMs);
  } finally {
    clearTimeout(timer);
    stream.close();
  }
  return stream.events;
}
