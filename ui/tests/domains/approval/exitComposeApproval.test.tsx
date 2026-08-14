/**
 * ExitComposeMode 审批特化测试：
 * 标题「提交设计草稿」、详情区渲染 design 文件全文（designFile 能力）、
 * 决策（批准/拒绝/修改意见）经 api.approvals.resolve 回传、无能力降级。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalStore } from "../../../src/domains/approval/ApprovalStore.js";
import { ApprovalPanel } from "../../../src/domains/approval/components/ApprovalPanel.js";
import { ExitComposeApprovalView } from "../../../src/domains/approval/components/ExitComposeApprovalView.js";
import { FrontendPlatformProvider } from "../../../src/platform/FrontendPlatformContext.js";
import type {
  DesignFilePort,
  FrontendPlatform,
} from "../../../src/platform/FrontendPlatform.js";
import type { NovelApiClient } from "@novel/core";

function makePlatform(designFile?: DesignFilePort): FrontendPlatform {
  return {
    capabilities: {
      fileSelection: false,
      clipboardRead: false,
      clipboardWrite: false,
      notifications: false,
    },
    files: { selectFiles: async () => [] },
    clipboard: { readText: async () => "", writeText: async () => undefined },
    notifications: { show: async () => undefined },
    ...(designFile === undefined ? {} : { designFile }),
  };
}

/** 一条 pending 的 ExitComposeMode 审批条目（当前 CMS 队列形状） */
function exitComposeItem() {
  return {
    conversationId: "c1",
    requestId: "approval_c1_1_tc-1",
    toolName: "ExitComposeMode",
    args: "{}",
    decisioner: "ui",
    status: "pending",
    requestedAt: "2026-08-14T09:00:00.000Z",
  };
}

/** 假 api：approvals.list 喂一条 Exit 条目 + resolve 记录调用 */
function makeApi(items: ReturnType<typeof exitComposeItem>[]) {
  return {
    approvals: {
      list: vi.fn().mockResolvedValue(items),
      resolve: vi.fn().mockResolvedValue(true),
    },
  } as unknown as NovelApiClient;
}

async function makeStore(items: ReturnType<typeof exitComposeItem>[]): Promise<ApprovalStore> {
  const store = new ApprovalStore({ api: makeApi(items) });
  await store.refresh();
  return store;
}

describe("ExitComposeApprovalView", () => {
  it("renders design content via markdown (pending 态)", async () => {
    const read = vi.fn().mockResolvedValue("## 第三章草稿\n\n正文设计…\n");
    render(
      <FrontendPlatformProvider platform={makePlatform({ read, write: vi.fn() })}>
        <ExitComposeApprovalView conversationId="c1" />
      </FrontendPlatformProvider>,
    );
    expect(await screen.findByText(/第三章草稿/)).toBeTruthy();
    expect(read).toHaveBeenCalledWith("c1");
  });

  it("无 designFile 能力：降级提示（不崩）", async () => {
    render(
      <FrontendPlatformProvider platform={makePlatform()}>
        <ExitComposeApprovalView conversationId="c1" />
      </FrontendPlatformProvider>,
    );
    expect(await screen.findByText(/设计草稿文件能力不可用/)).toBeTruthy();
  });
});

describe("ApprovalPanel ExitComposeMode 特化", () => {
  it("标题「提交设计草稿」+ 详情区渲染 design 文件全文，无「审批参数」区", async () => {
    const store = await makeStore([exitComposeItem()]);
    render(
      <FrontendPlatformProvider
        platform={makePlatform({
          read: vi.fn().mockResolvedValue("## 草稿全文\n\n段落一…\n"),
          write: vi.fn(),
        })}
      >
        <ApprovalPanel store={store} />
      </FrontendPlatformProvider>,
    );
    expect(screen.getAllByText("提交设计草稿").length).toBeGreaterThan(0);
    expect(await screen.findByText(/草稿全文/)).toBeTruthy();
    expect(screen.queryByText("审批参数")).not.toBeInTheDocument();
    expect(screen.queryByText(/无参数详情/)).not.toBeInTheDocument();
  });

  it("批准决策经 api.approvals.resolve 回传（requestId 命中）", async () => {
    const items = [exitComposeItem()];
    const api = makeApi(items);
    const store = new ApprovalStore({ api });
    await store.refresh();
    render(
      <FrontendPlatformProvider
        platform={makePlatform({
          read: vi.fn().mockResolvedValue("# 草稿\n"),
          write: vi.fn(),
        })}
      >
        <ApprovalPanel store={store} />
      </FrontendPlatformProvider>,
    );
    const approve = screen.getByRole("button", { name: "批准" });
    approve.click();
    await waitFor(() =>
      expect(api.approvals.resolve).toHaveBeenCalledWith(
        "approval_c1_1_tc-1",
        { kind: "approve" },
      ),
    );
  });

  it("请求修改：意见经 decideEdited 回传（edit 决策携带 text）", async () => {
    const items = [exitComposeItem()];
    const api = makeApi(items);
    const store = new ApprovalStore({ api });
    await store.refresh();
    const user = userEvent.setup();
    render(
      <FrontendPlatformProvider
        platform={makePlatform({
          read: vi.fn().mockResolvedValue("# 草稿\n"),
          write: vi.fn(),
        })}
      >
        <ApprovalPanel store={store} />
      </FrontendPlatformProvider>,
    );
    await user.click(screen.getByRole("button", { name: "请求修改" }));
    await user.type(screen.getByPlaceholderText(/填写修改意见/), "节奏太慢");
    await user.click(screen.getByRole("button", { name: "提交修改意见" }));
    await waitFor(() =>
      expect(api.approvals.resolve).toHaveBeenCalledWith(
        "approval_c1_1_tc-1",
        { kind: "edit", text: "节奏太慢" },
      ),
    );
  });
});
