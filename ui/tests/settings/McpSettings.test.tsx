/**
 * 设置「MCP 服务器」分类端到端（组件级）：卡片列表 + 启停覆盖 + draft 保存 +
 * 测试连接（工具预览/失败原因）+ 两步删除确认。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ConfigSnapshot, McpServerConfig, McpServerInput, McpTestResult } from "@novel/core";
import { SettingsDialog } from "../../src/settings/SettingsDialog.js";
import { ApplicationSettingsStore } from "../../src/settings/ApplicationSettingsStore.js";
import type { ApplicationConfigurationClient } from "../../src/settings/ApplicationConfigurationClient.js";

function makeServer(overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "srv_1",
    name: "天气查询",
    transport: { type: "stdio", command: "npx", args: ["-y", "weather-mcp"] },
    enabled: true,
    trusted: false,
    ...overrides,
  };
}

function makeClient(options?: {
  servers?: McpServerConfig[];
  testResult?: McpTestResult;
}): ApplicationConfigurationClient & { mutate: ReturnType<typeof vi.fn>; testMcp: ReturnType<typeof vi.fn> } {
  const servers = options?.servers ?? [makeServer()];
  const snapshot = {
    profiles: [],
    credentials: {},
    diagnostics: { logLevel: "info" },
    mcpServers: servers,
  } as unknown as ConfigSnapshot;
  return {
    load: vi.fn(async () => snapshot),
    mutate: vi.fn(async () => {}),
    testMcp: vi.fn(async (_input: McpServerInput) =>
      options?.testResult ?? { ok: true, toolCount: 2, tools: [{ name: "lookup" }, { name: "forecast", description: "预报" }] },
    ),
  };
}

function openPanel(client: ApplicationConfigurationClient): void {
  render(
    <SettingsDialog
      open
      store={new ApplicationSettingsStore()}
      configuration={client}
      onDismiss={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "MCP 服务器" }));
}

describe("McpSettings", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists server cards and patches enabled via mcp.upsert", async () => {
    const client = makeClient();
    openPanel(client);
    expect(await screen.findByText("天气查询")).toBeDefined();
    expect(screen.getByText(/npx -y weather-mcp/)).toBeDefined();

    const toggle = screen.getByRole("checkbox", { name: "启用 天气查询" });
    expect(toggle).toHaveProperty("checked", true);
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(client.mutate).toHaveBeenCalledWith({
        op: "mcp.upsert",
        serverId: "srv_1",
        server: expect.objectContaining({ enabled: false }),
      });
    });
  });

  it("saves a new stdio server from draft form (args split + validated)", async () => {
    const client = makeClient({ servers: [] });
    openPanel(client);
    expect(await screen.findByText(/尚未添加/)).toBeDefined();

    fireEvent.change(screen.getByLabelText("MCP 服务器名称"), { target: { value: "资料库" } });
    fireEvent.change(screen.getByLabelText("MCP stdio 命令"), { target: { value: "node" } });
    fireEvent.change(screen.getByLabelText("MCP stdio 参数"), { target: { value: "  server.js   --foo " } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      expect(client.mutate).toHaveBeenCalledWith({
        op: "mcp.upsert",
        serverId: expect.stringMatching(/^mcp_/),
        server: {
          name: "资料库",
          transport: { type: "stdio", command: "node", args: ["server.js", "--foo"] },
          enabled: true,
          trusted: false,
        },
      });
    });
    expect(await screen.findByText(/已保存，对新会话生效/)).toBeDefined();
  });

  it("test connection shows tool preview on ok and error line on failure", async () => {
    const okClient = makeClient();
    openPanel(okClient);
    fireEvent.change(screen.getByLabelText("MCP 服务器名称"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("MCP stdio 命令"), { target: { value: "npx" } });
    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));
    expect(await screen.findByText(/连接正常 ✓ 提供 2 个工具/)).toBeDefined();
    expect(screen.getByText("forecast")).toBeDefined();
    expect(okClient.testMcp).toHaveBeenCalledWith(
      expect.objectContaining({ transport: { type: "stdio", command: "npx", args: [] } }),
    );

    cleanup();
    const failClient = makeClient({
      testResult: { ok: false, error: "连接超时：服务器在 8 秒内未完成握手" },
    });
    openPanel(failClient);
    fireEvent.change(screen.getByLabelText("MCP 服务器名称"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("MCP stdio 命令"), { target: { value: "npx" } });
    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));
    expect(await screen.findByText(/连接失败：连接超时/)).toBeDefined();
  });

  it("delete requires a second confirming click", async () => {
    const client = makeClient();
    openPanel(client);
    await screen.findByText("天气查询");
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    expect(client.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /确认删除/ }));
    await waitFor(() => {
      expect(client.mutate).toHaveBeenCalledWith({ op: "mcp.remove", serverId: "srv_1" });
    });
  });
});
