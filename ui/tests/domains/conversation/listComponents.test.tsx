/**
 * conversation 列表/菜单类组件测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComposerModeBar } from "../../../src/domains/conversation/components/ComposerModeBar.js";
import { ConversationItemMenu } from "../../../src/domains/conversation/components/ConversationItemMenu.js";
import { ConversationList } from "../../../src/domains/conversation/components/ConversationList.js";
import { ConversationListItem } from "../../../src/domains/conversation/components/ConversationListItem.js";
import { MessageReferenceChip } from "../../../src/domains/conversation/components/MessageReference.js";
import { NewConversationButton } from "../../../src/domains/conversation/components/NewConversationButton.js";

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

describe("NewConversationButton / ComposerModeBar / MessageReferenceChip", () => {
  it("fires onClick and disables", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<NewConversationButton onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "创建对话" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ComposerModeBar switches mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComposerModeBar mode="chat" onChange={onChange} />);
    await user.click(screen.getByText("改写"));
    expect(onChange).toHaveBeenCalledWith("rewrite");
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
