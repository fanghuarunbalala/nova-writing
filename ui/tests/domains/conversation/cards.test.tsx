/**
 * 卡片 renderer 与注册表测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createDefaultConversationCardRendererRegistry } from "../../../src/domains/conversation/cards/defaultRenderers.js";
import { RichTextRenderer } from "../../../src/domains/conversation/cards/RichTextRenderer.js";
import type { ConversationCardDescriptor, RichText } from "../../../src/domains/conversation/projection/ConversationCardDescriptor.js";

const richText: RichText = {
  kind: "text",
  text: "把'雨很大'改为'雨落得密'",
};

const proposalCard: ConversationCardDescriptor = {
  kind: "proposal",
  id: "card-proposal-1",
  content: {
    tag: "proposal",
    title: "调整雨景描写",
    meta: "r041 -> r042",
    changeSetId: "CS-20260805-01",
    ops: [
      {
        id: "op-1",
        mark: "mod",
        kind: "manuscript",
        description: richText,
      },
    ],
  },
};

const diffCard: ConversationCardDescriptor = {
  kind: "diff",
  id: "card-diff-1",
  content: { changeSetId: "CS-20260805-01", summary: "4 处变更" },
};

const tableCard: ConversationCardDescriptor = {
  kind: "table",
  id: "card-table-1",
  content: {
    headers: ["角色", "状态"],
    rows: [
      [{ kind: "text", text: "林夏" }, { kind: "text", text: "已建档" }],
    ],
  },
};

const quoteCard: ConversationCardDescriptor = {
  kind: "quote",
  id: "card-quote-1",
  content: { text: richText, attribution: "第七章" },
};

const planCard: ConversationCardDescriptor = {
  kind: "plan",
  id: "card-plan-1",
  content: {
    ops: [
      { id: "op-plan-1", mark: "plan", kind: "todo", description: richText },
    ],
  },
};

describe("ConversationCardRendererRegistry", () => {
  it("registers the six default renderers and resolves by kind", () => {
    const registry = createDefaultConversationCardRendererRegistry();
    for (const kind of ["text", "proposal", "diff", "table", "quote", "plan"] as const) {
      expect(registry.has(kind)).toBe(true);
      expect(registry.get(kind)).toBeDefined();
    }
  });
});

describe("card renderers", () => {
  it("renders a proposal card with ops and view-diff action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const registry = createDefaultConversationCardRendererRegistry();
    const renderer = registry.get("proposal");
    expect(renderer).toBeDefined();
    const rendered = renderer!.render({ card: proposalCard, onAction });
    render(<>{rendered}</>);
    expect(screen.getByText("调整雨景描写")).toBeInTheDocument();
    expect(screen.getByText("修改")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "前往审批 Diff" }));
    expect(onAction).toHaveBeenCalledWith("view-diff", "CS-20260805-01");
  });

  it("renders diff, table, quote and plan cards", () => {
    const registry = createDefaultConversationCardRendererRegistry();
    const cases: ConversationCardDescriptor[] = [diffCard, tableCard, quoteCard, planCard];
    for (const card of cases) {
      const renderer = registry.get(card.kind);
      expect(renderer).toBeDefined();
      const rendered = renderer!.render({ card });
      render(<>{rendered}</>);
    }
    expect(screen.getAllByText("4 处变更").length).toBeGreaterThan(0);
    expect(screen.getByText("林夏")).toBeInTheDocument();
    expect(screen.getByText("—— 第七章")).toBeInTheDocument();
  });
});

describe("RichTextRenderer", () => {
  it("renders reference chips and fires the callback", async () => {
    const user = userEvent.setup();
    const onReference = vi.fn();
    render(
      <RichTextRenderer
        richText={{ kind: "reference", refKind: "character", id: "char-linxia", label: "林夏" }}
        onReference={onReference}
      />,
    );
    await user.click(screen.getByRole("button", { name: "林夏" }));
    expect(onReference).toHaveBeenCalledWith({
      refKind: "character",
      id: "char-linxia",
      label: "林夏",
    });
  });
});
