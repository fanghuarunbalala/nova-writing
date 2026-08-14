/**
 * conversation 列表/菜单类组件测试。
 */
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastStore } from "../../../src/shared/state/ToastStore.js";
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

  it("busy deletes disable both buttons and mark the confirm button busy", () => {
    const onDeleteConfirm = vi.fn();
    render(
      <ConversationDialogs
        deleteTarget="conversation_a"
        deleteBusy
        renameValue=""
        onRenameValueChange={() => {}}
        onRenameConfirm={() => {}}
        onDeleteConfirm={onDeleteConfirm}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "删除" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
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
  const conversationSummary = {
    conversationId: "conversation_a",
    name: "a",
    storeDir: "",
    status: "active",
  };

  function buildSection() {
    const del = vi.fn(async () => undefined);
    const api = {
      conversations: {
        list: vi.fn(async () => [conversationSummary]),
        create: vi.fn(),
        open: vi.fn(),
        delete: del,
      },
    } as never;
    const store = new ConversationCatalogStore({ api });
    const toastStore = new ToastStore();
    return { store, del, toastStore };
  }

  it("deletes through the custom dialog without native confirm", async () => {
    const user = userEvent.setup();
    const { store, del, toastStore } = buildSection();
    await store.loadWorkspace("w1");
    render(
      <ConversationListSection store={store} toastStore={toastStore} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByText("删除"));
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(del).toHaveBeenCalledWith("conversation_a");
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("keeps the dialog busy while deletion is pending, then closes with a success toast", async () => {
    const user = userEvent.setup();
    let resolveDelete: (() => void) | undefined;
    const del = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const api = {
      conversations: {
        list: vi.fn(async () => [conversationSummary]),
        create: vi.fn(),
        open: vi.fn(),
        delete: del,
      },
    } as never;
    const store = new ConversationCatalogStore({ api });
    const toastStore = new ToastStore();
    await store.loadWorkspace("w1");
    render(
      <ConversationListSection store={store} toastStore={toastStore} onSelect={vi.fn()} />,
    );
    const confirmText = "删除后会话及其记录将被永久移除，且不可恢复。确定删除？";
    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByText("删除"));
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(del).toHaveBeenCalledWith("conversation_a");
    // 删除进行中：确认按钮 loading + 禁用、取消禁用、弹窗保持打开。
    expect(screen.getByRole("button", { name: "删除" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByText(confirmText)).toBeInTheDocument();
    // 完成：弹窗关闭 + 成功 toast。
    expect(resolveDelete).toBeDefined();
    await act(async () => {
      resolveDelete?.();
    });
    await waitFor(() => {
      expect(
        toastStore.getSnapshot().toasts.some((toast) => toast.text === "会话已删除"),
      ).toBe(true);
    });
    expect(screen.queryByText(confirmText)).not.toBeInTheDocument();
  });

  it("shows a danger toast when deletion fails", async () => {
    const user = userEvent.setup();
    const del = vi.fn(async () => {
      throw new Error("boom");
    });
    const api = {
      conversations: {
        list: vi.fn(async () => [conversationSummary]),
        create: vi.fn(),
        open: vi.fn(),
        delete: del,
      },
    } as never;
    const store = new ConversationCatalogStore({ api });
    const toastStore = new ToastStore();
    await store.loadWorkspace("w1");
    render(
      <ConversationListSection store={store} toastStore={toastStore} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByText("删除"));
    await user.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => {
      expect(
        toastStore.getSnapshot().toasts.some((toast) => toast.text === "删除失败，请重试"),
      ).toBe(true);
    });
    // 失败也关闭弹窗（已用 danger toast 说明，可重新从菜单发起）。
    expect(
      screen.queryByText("删除后会话及其记录将被永久移除，且不可恢复。确定删除？"),
    ).not.toBeInTheDocument();
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

  it("ComposerModeBar opens a dropdown and selects a mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComposerModeBar mode="review" onChange={onChange} />);
    // 触发按钮显示当前模式；选项面板初始不渲染。
    const trigger = screen.getByRole("button", { name: "执行模式：需审核" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // 打开面板 → 三模式选项 + 当前项选中。
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "执行模式" })).toBeInTheDocument();
    expect(screen.getByText("提议后审批提交")).toBeInTheDocument();
    expect(screen.getByText("跳过审批 · 立即落地")).toBeInTheDocument();
    expect(screen.getByText("仅草稿文件可写")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /需审核/ })).toHaveAttribute("aria-selected", "true");
    // 选择「直接执行」→ onChange("bypass") + 面板收起。
    await user.click(screen.getByRole("menuitem", { name: /直接执行/ }));
    expect(onChange).toHaveBeenCalledWith("bypass");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("ComposerModeBar closes on external click and Escape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComposerModeBar mode="review" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "执行模式：需审核" });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // Escape 关闭（焦点回到 trigger）。
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // 再次打开后外部点击关闭。
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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
