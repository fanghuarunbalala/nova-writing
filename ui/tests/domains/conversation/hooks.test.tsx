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
        list: vi.fn(async () => ({ conversations: [] })),
        create: vi.fn(async () => ({
          getSnapshot: async () => ({
            metadata: {
              id: "conversation_new",
              workspaceId: "w1",
              rootConversationId: "conversation_new",
              status: "active",
              createdAt: "2026-08-05T09:00:00.000Z",
              updatedAt: "2026-08-05T09:00:00.000Z",
              lastJournalSequence: 0,
            },
            activeAgentBinding: {
              id: "b1",
              conversationId: "conversation_new",
              revision: 1,
              status: "active",
              createdAt: "2026-08-05T09:00:00.000Z",
              agentType: "novel",
              definitionVersion: "1.0.0",
            },
          }),
          close: async () => undefined,
        })),
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
      events: [],
      timeline: [],
      userMessages: [],
      assistantMessages: [],
      approvals: [],
      runs: [],
      turns: [],
      ...overrides,
    };
  }

  it("is idle without presence and live while generating", () => {
    function Probe({ snapshot }: { readonly snapshot: ConversationProjectionSnapshot | undefined }) {
      const { state } = useConversationRuntimeStatus(snapshot);
      return <output>{state}</output>;
    }
    const { rerender } = render(<Probe snapshot={undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("idle");
    rerender(
      <Probe
        snapshot={projection({
          runtimePresence: { state: "online", observedAt: "" },
          runs: [{ runId: "r1", inputEventId: "e1", inputEventType: "user.text", inputEventSequence: 1, previous: null, current: "running", reason: "started", lastSequence: 1 }],
          turns: [{ runId: "r1", turnId: "t1", previous: null, current: "running", reason: "started", lastSequence: 1 }],
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("live");
  });

  it("reports recoverable (disconnected) state for crashed presence", () => {
    function Probe() {
      const { state } = useConversationRuntimeStatus(
        projection({ runtimePresence: { state: "crashed", observedAt: "" } }),
        "runtime_crash",
      );
      return <output>{state}</output>;
    }
    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent("disconnected");
  });

  it("reports failed state for hard configuration failures", () => {
    function Probe() {
      const { state } = useConversationRuntimeStatus(
        projection({ runtimePresence: { state: "crashed", observedAt: "" } }),
        "credential_missing",
      );
      return <output>{state}</output>;
    }
    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent("failed");
  });

  it("derives currentRun from the latest run and turn", () => {
    function Probe() {
      const { currentRun } = useConversationRuntimeStatus(
        projection({
          runtimePresence: { state: "online", observedAt: "" },
          runs: [{ runId: "r9", inputEventId: "e1", inputEventType: "user.text", inputEventSequence: 1, previous: null, current: "completed", reason: "completed", lastSequence: 2 }],
          turns: [{ runId: "r9", turnId: "t9", previous: null, current: "completed", reason: "completed", lastSequence: 2 }],
        }),
      );
      return <output>{currentRun?.runId}:{currentRun?.turnId}</output>;
    }
    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent("r9:t9");
  });
});
