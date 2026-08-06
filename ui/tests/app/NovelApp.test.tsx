/**
 * NovelApp 启动路由：无 Workspace 时渲染选择页；打开后切到工作台壳。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NovelApp } from "../../src/app/NovelApp.js";
import { WorkspaceController } from "../../src/domains/workspace/controller/WorkspaceController.js";
import type { FrontendPlatform } from "../../src/platform/index.js";

const platform: FrontendPlatform = {
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
};

function buildApi() {
  return {
    conversations: {
      list: vi.fn(async () => ({ conversations: [] })),
      create: vi.fn(async () => ({
        getSnapshot: async () => ({
          metadata: {
            id: "conversation_new",
            workspaceId: "ws-1",
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
    novel: {
      overview: {
        get: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          workspaceId: "ws-1",
          novelId: "novel_1",
          novelSchemaVersion: 1,
          sourceRevision: "r041",
          counts: {
            storyUnitCount: 0,
            characterCount: 0,
            locationCount: 0,
            volumeCount: 0,
            chapterCount: 0,
            manuscriptBlockCount: 0,
          },
          roots: {},
        })),
      },
      outline: {
        get: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          tree: { outline: { id: "o1", novelId: "novel_1" }, units: [] },
          progress: [],
        })),
        getStoryUnit: vi.fn(),
      },
      characters: {
        list: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          characters: [],
        })),
        get: vi.fn(),
      },
      locations: {
        list: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          locations: [],
        })),
        get: vi.fn(),
      },
      manuscript: {
        getStructure: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          blocks: [],
        })),
        getBlock: vi.fn(),
      },
    },
  } as never;
}

function buildController() {
  const picker = {
    pickWorkspace: vi.fn(async () => ({
      referenceId: "ref-1",
      label: "白昼计划",
    })),
  };
  const sessions = {
    listRecent: vi.fn(async () => [{ id: "ws-1", label: "白昼计划" }]),
    open: vi.fn(async () => ({ id: "ws-1", label: "白昼计划" })),
    close: vi.fn(async () => undefined),
  };
  const controller = new WorkspaceController({ picker, sessions });
  return { controller, picker, sessions };
}

describe("NovelApp launch routing", () => {
  it("renders the project selection page when no workspace is open", async () => {
    const { controller, sessions } = buildController();
    render(<NovelApp api={buildApi()} platform={platform} workspaceController={controller} />);
    expect(await screen.findByText("选择小说项目")).toBeInTheDocument();
    expect(await screen.findByText("白昼计划")).toBeInTheDocument();
    expect(sessions.listRecent).toHaveBeenCalledTimes(1);
  });

  it("opens a recent workspace and switches to the workbench shell", async () => {
    const user = userEvent.setup();
    const { controller, sessions } = buildController();
    render(<NovelApp api={buildApi()} platform={platform} workspaceController={controller} />);
    await user.click(await screen.findByRole("button", { name: /白昼计划/ }));
    expect(sessions.open).toHaveBeenCalledWith({
      referenceId: "ws-1",
      label: "白昼计划",
    });
    expect(await screen.findByText("Novel")).toBeInTheDocument();
    expect(screen.queryByText("选择小说项目")).not.toBeInTheDocument();
  });
});
