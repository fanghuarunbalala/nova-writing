/**
 * mcp.upsert / mcp.remove 配置域测试：校验（非法名称/传输拒绝）+ 双 store 往返 +
 * 损坏条目丢弃回退。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryConfigStore } from "../InMemoryConfigStore.js";
import { NodeApplicationConfigStore } from "../../node/config/NodeApplicationConfigStore.js";
import type { McpServerInput } from "../contract.js";
import type { CredentialCipher } from "../CredentialCipher.js";

const plainCipher: CredentialCipher = {
  encrypt: async (s) => s,
  decrypt: async (s) => s,
};

function makeInput(overrides?: Partial<McpServerInput>): McpServerInput {
  return {
    name: "天气查询",
    transport: { type: "stdio", command: "npx", args: ["-y", "weather-mcp"] },
    enabled: true,
    trusted: false,
    ...overrides,
  };
}

describe("InMemoryConfigStore mcp ops", () => {
  it("upsert 追加/替换 + remove + 快照暴露", async () => {
    const store = new InMemoryConfigStore();
    await store.mutate({ op: "mcp.upsert", serverId: "srv_1", server: makeInput() });
    await store.mutate({
      op: "mcp.upsert",
      serverId: "srv_2",
      server: makeInput({ name: "资料", transport: { type: "http", url: "https://example.com/mcp" } }),
    });
    expect((await store.get()).mcpServers?.map((s) => s.id)).toEqual(["srv_1", "srv_2"]);
    await store.mutate({ op: "mcp.upsert", serverId: "srv_1", server: makeInput({ name: "改名" }) });
    expect((await store.get()).mcpServers?.find((s) => s.id === "srv_1")?.name).toBe("改名");
    expect((await store.get()).mcpServers).toHaveLength(2);
    await store.mutate({ op: "mcp.remove", serverId: "srv_2" });
    expect((await store.get()).mcpServers?.map((s) => s.id)).toEqual(["srv_1"]);
  });

  it("非法输入拒绝（空名/坏 URL/坏类型）且不影响既有值", async () => {
    const store = new InMemoryConfigStore();
    await store.mutate({ op: "mcp.upsert", serverId: "srv_1", server: makeInput() });
    await expect(
      store.mutate({ op: "mcp.upsert", serverId: "srv_x", server: makeInput({ name: "  " }) }),
    ).rejects.toThrowError(/名称需为/);
    await expect(
      store.mutate({
        op: "mcp.upsert",
        serverId: "srv_x",
        server: makeInput({ transport: { type: "http", url: "ftp://x" } }),
      }),
    ).rejects.toThrowError(/url/);
    await expect(
      store.mutate({
        op: "mcp.upsert",
        serverId: "srv_x",
        server: makeInput({ transport: { type: "grpc" } as never }),
      }),
    ).rejects.toThrowError(/传输类型/);
    expect((await store.get()).mcpServers).toHaveLength(1);
  });
});

describe("NodeApplicationConfigStore mcp ops", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "novel-config-mcp-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("落盘并重启往返；移除后不落字段", async () => {
    const filePath = join(dir, "config.json");
    const store = new NodeApplicationConfigStore({ filePath, cipher: plainCipher });
    await store.load();
    await store.mutate({ op: "mcp.upsert", serverId: "srv_1", server: makeInput() });
    const reopened = new NodeApplicationConfigStore({ filePath, cipher: plainCipher });
    await reopened.load();
    expect((await reopened.get()).mcpServers?.[0]).toMatchObject({
      id: "srv_1",
      name: "天气查询",
      trusted: false,
    });
    await reopened.mutate({ op: "mcp.remove", serverId: "srv_1" });
    const after = new NodeApplicationConfigStore({ filePath, cipher: plainCipher });
    await after.load();
    expect((await after.get()).mcpServers).toBeUndefined();
  });

  it("损坏条目丢弃、合法条目保留", async () => {
    const filePath = join(dir, "config.json");
    await writeFile(
      filePath,
      JSON.stringify({
        profiles: [],
        credentials: {},
        mcpServers: [{ id: "bad", name: "", transport: { type: "http", url: "https://x" }, enabled: true, trusted: false }, makeInput()],
      }),
      "utf8",
    );
    const store = new NodeApplicationConfigStore({ filePath, cipher: plainCipher });
    await store.load();
    expect((await store.get()).mcpServers?.map((s) => s.name)).toEqual(["天气查询"]);
  });
});
