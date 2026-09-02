/**
 * conversation 域 hooks 测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConversationProjectionSnapshot } from "@novel/core";
import { ConversationCatalogStore } from "../../../src/domains/conversation/store/ConversationCatalogStore.js";
import { ComposerDraftStore } from "../../../src/domains/conversation/store/ComposerDraftStore.js";
import { useComposerDraft } from "../../../src/domains/conversation/hooks/useComposerDraft.js";
import { useConversationCatalog } from "../../../src/domains/conversation/hooks/useConversationCatalog.js";
import { useConversationRuntimeStatus } from "../../../src/domains/conversation/hooks/useConversationRuntimeStatus.js";

describe("useConversationCatalog", () => {
  it("renders snapshot and exposes store actions", async () => {
    const user = userEvent.setup();
    const api = {
      conversations: {
        list: vi.fn(async () => []),
        create: vi.fn(async () => ({ conversationId: "conversation_new", handle: {} })),
        open: vi.fn(),
      },
    } as never;

    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");

    function Probe() {
      const { snapshot, createConversation } = useConversationCatalog(store);
      return (
        <>
          <output>{snapshot.phase}</output>
          <button type="button" onClick={() => void createConversation()}>
            新建
          </button>
        </>
      );
    }

    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent("ready");
    await user.click(screen.getByRole("button", { name: "新建" }));
    expect(api.conversations.create).toHaveBeenCalledTimes(1);
  });
});

describe("useComposerDraft", () => {
  it("reads and mutates the conversation draft", async () => {
    const user = userEvent.setup();
    const store = new ComposerDraftStore();

    function Probe() {
      const { draft, setText, setMode } = useComposerDraft(store, "c1");
      return (
        <>
          <output>
            {draft?.text ?? "(empty)"}:{draft?.mode ?? "none"}
          </output>
          <button type="button" onClick={() => setText("草稿")}>
            写草稿
          </button>
          <button type="button" onClick={() => setMode("bypass")}>
            直接执行
          </button>
        </>
      );
    }

    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent("(empty):none");
    await user.click(screen.getByRole("button", { name: "写草稿" }));
    await user.click(screen.getByRole("button", { name: "直接执行" }));
    expect(screen.getByRole("status")).toHaveTextContent("草稿:bypass");
  });
});

describe("useConversationRuntimeStatus", () => {
  function projection(overrides: Partial<ConversationProjectionSnapshot>): ConversationProjectionSnapshot {
    return {
      conversationId: "c1",
      revision: 1,
      lastAppliedSequence: 0,
      state: "idle",
      timeline: [],
      cards: [],
      approvals: [],
      toolTraces: [],
      eventFlow: [],
      ...overrides,
    };
  }

  it("is idle without projection and live while running", () => {
    function Probe({ snapshot }: { readonly snapshot: ConversationProjectionSnapshot | undefined }) {
      const { state } = useConversationRuntimeStatus(snapshot);
      return <output>{state}</output>;
    }
    const { rerender } = render(<Probe snapshot={undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("idle");
    rerender(<Probe snapshot={projection({ state: "running" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("live");
  });

  it("reports recoverable (disconnected) state for stopped projection", () => {
    function Probe() {
      const { state } = useConversationRuntimeStatus(projection({ state: "stopped" }));
      return <output>{state}</output>;
    }
    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent("disconnected");
  });

  it("reports failed state for hard configuration failures", () => {
    function Probe() {
      const { state } = useConversationRuntimeStatus(projection({ state: "error" }));
      return <output>{state}</output>;
    }
    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent("failed");
  });
});
