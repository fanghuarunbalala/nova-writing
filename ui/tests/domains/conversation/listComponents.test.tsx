/**
 * conversation 列表/菜单类组件测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComposerModeBar } from "../../../src/domains/conversation/components/ComposerModeBar.js";
import { ConversationDialogs } from "../../../src/domains/conversation/components/ConversationDialogs.js";
import { ConversationItemMenu } from "../../../src/domains/conversation/components/ConversationItemMenu.js";
import { ConversationList } from "../../../src/domains/conversation/components/ConversationList.js";
import { ConversationListItem } from "../../../src/domains/conversation/components/ConversationListItem.js";
import { MessageReferenceChip } from "../../../src/domains/conversation/components/MessageReference.js";
import { NewConversationButton } from "../../../src/domains/conversation/components/NewConversationButton.js";
import { ConversationCatalogStore } from "../../../src/domains/conversation/store/ConversationCatalogStore.js";
import { ConversationListSection } from "../../../src/shell/sidebar/sections/ConversationListSection.js";

// G7 后不应再调用原生 prompt/confirm；spy 兜底并用于断言未触发。
vi.spyOn(window, "prompt").mockReturnValue(null);
vi.spyOn(window, "confirm").mockReturnValue(false);

const item = Object.freeze({
  id: "conversation_a",
  title: "对话 a",
  agentLabel: "Novel Agent",
  lastActivityAt: 1000,
});

describe("ConversationListItem", () => {
  it("selects on click and marks active", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <ConversationListItem item={item} active={false} onSelect={onSelect} />,
    );
    await user.click(screen.getByText("对话 a"));
    expect(onSelect).toHaveBeenCalledWith("conversation_a");
    rerender(<ConversationListItem item={item} active onSelect={onSelect} />);
    expect(screen.getByText("对话 a").closest("div")).toHaveClass("active");
  });

  it("shows generating and failed indicators", () => {
    const { rerender } = render(
      <ConversationListItem item={{ ...item, status: "generating" }} active onSelect={vi.fn()} />,
    );
    expect(screen.getByLabelText("生成中")).toBeInTheDocument();
    rerender(
      <ConversationListItem item={{ ...item, status: "failed" }} active onSelect={vi.fn()} />,
    );
    expect(screen.getByLabelText("失败")).toBeInTheDocument();
  });
});

describe("ConversationList", () => {
  it("renders the new-conversation button and items", () => {
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    render(
      <ConversationList
        conversations={[item, { ...item, id: "conversation_b", title: "对话 b" }]}
        activeId="conversation_a"
        onSelect={onSelect}
        onCreate={onCreate}
      />,
    );
    expect(screen.getByRole("button", { name: "创建对话" })).toBeInTheDocument();
    expect(screen.getByText("对话 a")).toBeInTheDocument();
    expect(screen.getByText("对话 b")).toBeInTheDocument();
  });
});

describe("ConversationItemMenu", () => {
  it("fires rename, pin and delete actions", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onPin = vi.fn();
    const onDelete = vi.fn();
    render(
      <ConversationItemMenu
        conversationId="conversation_a"
        onRename={onRename}
        onPin={onPin}
        onDelete={onDelete}
      />,
    );
    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByText("重命名"));
    expect(onRename).toHaveBeenCalledWith("conversation_a");
    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByText("置顶"));
    expect(onPin).toHaveBeenCalledWith("conversation_a", true);
    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByText("删除"));
    expect(onDelete).toHaveBeenCalledWith("conversation_a");
  });

  it("omits actions without callbacks", async () => {
    const user = userEvent.setup();
    render(<ConversationItemMenu conversationId="c1" />);
    await user.click(screen.getByRole("button", { name: "对话操作" }));
    expect(screen.queryByText("重命名")).not.toBeInTheDocument();
    expect(screen.queryByText("删除")).not.toBeInTheDocument();
  });
});

describe("ConversationDialogs", () => {
  it("renames via the dialog without native prompt", async () => {
    const user = userEvent.setup();
    const onRenameValueChange = vi.fn();
    const onRenameConfirm = vi.fn();
    const onDeleteConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConversationDialogs
        renameTarget={{ id: "conversation_a", title: "对话 a" }}
        renameValue="对话 a"
        onRenameValueChange={onRenameValueChange}
        onRenameConfirm={onRenameConfirm}
        onDeleteConfirm={onDeleteConfirm}
        onClose={onClose}
      />,
    );
    const input = screen.getByRole("textbox", { name: "对话名称" }) as HTMLInputElement;
    expect(input.value).toBe("对话 a");
    await user.clear(input);
    await user.type(input, "新名字");
    expect(onRenameValueChange).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onRenameConfirm).toHaveBeenCalledTimes(1);
    expect(onDeleteConfirm).not.toHaveBeenCalled();
    expect(window.prompt).not.toHaveBeenCalled();
  });

  it("disables rename save for an empty name", async () => {
    const user = userEvent.setup();
    const onRenameConfirm = vi.fn();
    render(
      <ConversationDialogs
        renameTarget={{ id: "conversation_a", title: "对话 a" }}
        renameValue=""
        onRenameValueChange={() => {}}
        onRenameConfirm={onRenameConfirm}
        onDeleteConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onRenameConfirm).not.toHaveBeenCalled();
  });

  it("confirms deletion via the dialog without native confirm", async () => {
    const user = userEvent.setup();
    const onDeleteConfirm = vi.fn();
    const onRenameConfirm = vi.fn();
    render(
      <ConversationDialogs
        deleteTarget="conversation_a"
        renameValue=""
        onRenameValueChange={() => {}}
        onRenameConfirm={onRenameConfirm}
        onDeleteConfirm={onDeleteConfirm}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onDeleteConfirm).toHaveBeenCalledTimes(1);
    expect(onRenameConfirm).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("closes on cancel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ConversationDialogs
        renameTarget={{ id: "conversation_a", title: "对话 a" }}
        renameValue="对话 a"
        onRenameValueChange={() => {}}
        onRenameConfirm={() => {}}
        onDeleteConfirm={() => {}}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ConversationListSection dialogs", () => {
  function buildSection() {
    const rename = vi.fn(async () => undefined);
    const del = vi.fn(async () => undefined);
    const api = {
      conversations: {
        list: vi.fn(async () => ({
          conversations: [
            {
              metadata: {
                id: "conversation_a",
                workspaceId: "w1",
                rootConversationId: "conversation_a",
                status: "active",
                createdAt: "2026-08-05T09:00:00.000Z",
                updatedAt: "2026-08-05T09:00:00.000Z",
                lastJournalSequence: 0,
              },
              activeAgentBinding: {
                id: "b1",
                conversationId: "conversation_a",
                revision: 1,
                status: "active",
                createdAt: "2026-08-05T09:00:00.000Z",
                agentType: "novel",
                definitionVersion: "1.0.0",
              },
            },
          ],
        })),
        create: vi.fn(),
        open: vi.fn(),
        rename,
        delete: del,
      },
    } as never;
    const store = new ConversationCatalogStore({ api });
    return { store, rename, del };
  }

  it("renames through the custom dialog without native prompt", async () => {
    const user = userEvent.setup();
    const { store, rename } = buildSection();
    await store.loadWorkspace("w1");
    render(<ConversationListSection store={store} onSelect={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByText("重命名"));
    const input = screen.getByRole("textbox", { name: "对话名称" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "雨夜对话");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(rename).toHaveBeenCalledWith("conversation_a", "雨夜对话");
    expect(window.prompt).not.toHaveBeenCalled();
  });

  it("deletes through the custom dialog without native confirm", async () => {
    const user = userEvent.setup();
    const { store, del } = buildSection();
    await store.loadWorkspace("w1");
    render(<ConversationListSection store={store} onSelect={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByText("删除"));
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(del).toHaveBeenCalledWith("conversation_a");
    expect(window.confirm).not.toHaveBeenCalled();
  });
});

describe("NewConversationButton / ComposerModeBar / MessageReferenceChip", () => {
  it("fires onClick and disables", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<NewConversationButton onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "创建对话" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ComposerModeBar cycles mode and renders hint", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<ComposerModeBar mode="review" onChange={onChange} />);
    expect(screen.getByText("提议后审批提交")).toBeInTheDocument();
    expect(screen.getByText("直接执行")).toBeInTheDocument();
    expect(screen.getByText("设计")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /执行模式：需审核/ }));
    expect(onChange).toHaveBeenCalledWith("bypass");
    rerender(<ComposerModeBar mode="compose" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /执行模式：设计/ }));
    expect(onChange).toHaveBeenLastCalledWith("review");
  });

  it("MessageReferenceChip fires onClick with the reference", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <MessageReferenceChip
        reference={{ refKind: "location", id: "loc-dock7", label: "旧船坞" }}
        onClick={onClick}
      />,
    );
    await user.click(screen.getByRole("button", { name: "旧船坞" }));
    expect(onClick).toHaveBeenCalledWith({
      refKind: "location",
      id: "loc-dock7",
      label: "旧船坞",
    });
  });
});
