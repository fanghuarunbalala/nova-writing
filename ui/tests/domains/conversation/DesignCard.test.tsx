/**
 * DesignCard 测试：读取渲染、编辑保存写回、能力缺失降级。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesignCard } from "../../../src/domains/conversation/components/DesignCard.js";
import { FrontendPlatformProvider } from "../../../src/platform/FrontendPlatformContext.js";
import type {
  DesignFilePort,
  FrontendPlatform,
} from "../../../src/platform/FrontendPlatform.js";

function makePlatform(
  designFile?: DesignFilePort,
): FrontendPlatform {
  return {
    capabilities: {
      fileSelection: false,
      clipboardRead: false,
      clipboardWrite: false,
      notifications: false,
    },
    files: { selectFiles: async () => [] },
    clipboard: {
      readText: async () => "",
      writeText: async () => undefined,
    },
    notifications: { show: async () => undefined },
    ...(designFile === undefined ? {} : { designFile }),
  };
}

describe("DesignCard", () => {
  it("renders design content via markdown", async () => {
    const read = vi.fn().mockResolvedValue("第三章正文草稿\n");
    render(
      <FrontendPlatformProvider
        platform={makePlatform({ read, write: vi.fn() })}
      >
        <DesignCard conversationId="conversation:e2e" phase="designing" />
      </FrontendPlatformProvider>,
    );
    expect(await screen.findByText(/第三章正文草稿/)).toBeTruthy();
    expect(read).toHaveBeenCalledWith("conversation:e2e");
  });

  it("edits and saves content back to the design file", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <FrontendPlatformProvider
        platform={makePlatform({
          read: vi.fn().mockResolvedValue("旧内容\n"),
          write,
        })}
      >
        <DesignCard conversationId="conversation:e2e" phase="designing" />
      </FrontendPlatformProvider>,
    );
    await screen.findByText(/旧内容/);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "新内容\n");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith("conversation:e2e", "新内容\n"),
    );
  });

  it("shows the edit entry in the card header while pending approval (审批面板可改)", async () => {
    render(
      <FrontendPlatformProvider
        platform={makePlatform({
          read: vi.fn().mockResolvedValue("# 设计草稿\n"),
          write: vi.fn(),
        })}
      >
        <DesignCard conversationId="conversation:e2e" phase="pending" />
      </FrontendPlatformProvider>,
    );
    expect(await screen.findByText(/待审批/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
  });

  it("degrades to a note when the designFile capability is absent", () => {
    render(
      <FrontendPlatformProvider platform={makePlatform()}>
        <DesignCard conversationId="conversation:e2e" phase="designing" />
      </FrontendPlatformProvider>,
    );
    expect(screen.getByText(/能力不可用/)).toBeTruthy();
  });
});
