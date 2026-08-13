import { describe, it, expect } from "vitest";
import { expose, wrap } from "kkrpc";
import { electronIpcTransport, createSecureIpcBridge, type ElectronMessageEndpoint } from "../electron.js";

/** mock Electron 端点对（模拟 ipcMain ↔ ipcRenderer 双向） */
function createEndpointPair(): [ElectronMessageEndpoint, ElectronMessageEndpoint] {
  const aListeners = new Set<(_e: unknown, m: unknown) => void>();
  const bListeners = new Set<(_e: unknown, m: unknown) => void>();
  const a: ElectronMessageEndpoint = {
    send: (_ch, m) => bListeners.forEach((l) => l({}, m)),
    on: (_ch, l) => void aListeners.add(l),
    off: (_ch, l) => void aListeners.delete(l),
  };
  const b: ElectronMessageEndpoint = {
    send: (_ch, m) => aListeners.forEach((l) => l({}, m)),
    on: (_ch, l) => void bListeners.add(l),
    off: (_ch, l) => void bListeners.delete(l),
  };
  return [a, b];
}

describe("electronIpcTransport（Electron IPC RPC 往返）", () => {
  it("expose（main 侧）+ wrap（renderer 侧）经 IPC 通道往返", async () => {
    const [mainEp, rendererEp] = createEndpointPair();
    const mainTransport = electronIpcTransport({ endpoint: mainEp, channel: "novel-rpc" });
    const rendererTransport = electronIpcTransport({ endpoint: rendererEp, channel: "novel-rpc" });

    const api = {
      hello: (name: string) => `hi ${name}`,
      add: (a: number, b: number) => a + b,
    };
    expose(api, mainTransport);
    const client = wrap<typeof api>(rendererTransport);

    await new Promise((r) => setTimeout(r, 10)); // 等 kkrpc 握手
    expect(await client.hello("novel")).toBe("hi novel");
    expect(await client.add(1, 2)).toBe(3);
  });
});

describe("createSecureIpcBridge（channel 白名单）", () => {
  it("仅转发 allowedChannels，其他 channel 丢弃", () => {
    const sent: Array<{ channel: string }> = [];
    const ipcRenderer: ElectronMessageEndpoint = {
      send: (ch, m) => sent.push({ channel: ch, ...(m as object) }),
      on: () => {},
      off: () => {},
    };
    const bridge = createSecureIpcBridge({ ipcRenderer, allowedChannels: ["novel-rpc"] });
    bridge.send("novel-rpc", { type: "x" } as never);
    bridge.send("forbidden", { type: "y" } as never);
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe("novel-rpc");
  });

  it("on/off 仅对 allowedChannels 生效，其他 channel 忽略", () => {
    const registered = new Set<string>();
    const ipcRenderer: ElectronMessageEndpoint = {
      send: () => {},
      on: (ch) => void registered.add(ch),
      off: (ch) => void registered.delete(ch),
    };
    const bridge = createSecureIpcBridge({ ipcRenderer, allowedChannels: ["novel-rpc"] });
    bridge.on("novel-rpc", () => {});
    bridge.on("forbidden", () => {});
    expect(registered.has("novel-rpc")).toBe(true);
    expect(registered.has("forbidden")).toBe(false);
  });
});
