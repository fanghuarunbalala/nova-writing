/**
 * manuscript 子域测试。
 *
 * 适配说明：core manuscript -> paragraph 重命名后，store 改为读取
 * api.novel.paragraphs.getCatalog，UI 仍按 chapter -> blocks 视图渲染（单 chapter
 * "全部段落" 容纳所有段落）。测试用 paragraph catalog fixture 替代旧 structure。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  NovelApiClient,
  NovelParagraphCatalogSnapshot,
} from "@novel/core";
import { ManuscriptStructureStore } from "../../../src/domains/novel/manuscript/store/ManuscriptStructureStore.js";
import { ManuscriptChapterList } from "../../../src/domains/novel/manuscript/components/ManuscriptChapterList.js";
import { ManuscriptBlock } from "../../../src/domains/novel/manuscript/components/ManuscriptBlock.js";
import { ManuscriptDraftTag } from "../../../src/domains/novel/manuscript/components/ManuscriptDraftTag.js";

const catalog: NovelParagraphCatalogSnapshot = {
  schemaVersion: 1,
  scope: { kind: "canonical" },
  paragraphs: [
    {
      id: "§3-01-04",
      storyUnitId: "su-1",
      orderKey: "0001",
      textLength: 120,
      textDigest: "8f3a70ff",
    },
    {
      id: "§3-01-05",
      storyUnitId: "su-1",
      orderKey: "0002",
      textLength: 80,
      textDigest: "9e4b81ee",
    },
  ],
};

function buildApi(
  overrides: Partial<NovelApiClient["novel"]["paragraphs"]> = {},
): NovelApiClient {
  return {
    conversations: {} as never,
    novel: {
      overview: {} as never,
      outline: {} as never,
      characters: {} as never,
      locations: {} as never,
      paragraphs: {
        getCatalog: vi.fn(async () => catalog),
        get: vi.fn(),
        ...overrides,
      },
    },
  } as unknown as NovelApiClient;
}

describe("ManuscriptStructureStore", () => {
  it("maps paragraphs into a single chapter view", async () => {
    const api = buildApi();
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.chapters).toHaveLength(1);
    expect(snapshot.chapters[0].title).toBe("全部段落");
    expect(snapshot.chapters[0].blocks[0]).toMatchObject({
      blockId: "§3-01-04",
      digest: "8f3a70",
      text: "",
    });
    expect(snapshot.chapters[0].blocks).toHaveLength(2);
  });

  it("records a retryable error on failure", async () => {
    const api = buildApi({
      getCatalog: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().phase).toBe("error");
    expect(store.getSnapshot().error?.retryable).toBe(true);
  });
});

describe("manuscript components", () => {
  it("renders chapters and block selection", async () => {
    const user = userEvent.setup();
    const onSelectBlock = vi.fn();
    render(
      <ManuscriptChapterList
        workspaceId="w1"
        chapters={[
          {
            chapterId: "chapter-301",
            title: "Chapter 7",
            blocks: [{ blockId: "§3-01-04", digest: "8f3a70", text: "雨落得密。" }],
          },
        ]}
        onSelectBlock={onSelectBlock}
      />,
    );
    expect(screen.getByText("Chapter 7")).toBeInTheDocument();
    await user.click(screen.getByText("雨落得密。"));
    expect(onSelectBlock).toHaveBeenCalledWith("§3-01-04");
  });

  it("renders block primitives", () => {
    render(<ManuscriptBlock block={{ blockId: "§3-01-04", digest: "8f3a70", text: "" }} />);
    expect(screen.getByText("§3-01-04")).toBeInTheDocument();
    render(<ManuscriptDraftTag />);
    expect(screen.getByText("草稿")).toBeInTheDocument();
  });

  it("shows a 前往审批 entry on draft chapters and invokes onOpenDraft", async () => {
    const user = userEvent.setup();
    const onOpenDraft = vi.fn();
    render(
      <ManuscriptChapterList
        workspaceId="w1"
        chapters={[
          {
            chapterId: "chapter-draft-1",
            title: "第一节 夜景",
            isDraft: true,
            changeSetId: "CS-7",
            blocks: [{ blockId: "§3-01-04", digest: "8f3a70", text: "雨落得密。" }],
          },
        ]}
        onOpenDraft={onOpenDraft}
      />,
    );
    const entry = screen.getByRole("button", { name: "前往审批 →" });
    await user.click(entry);
    expect(onOpenDraft).toHaveBeenCalledTimes(1);
    expect(onOpenDraft).toHaveBeenCalledWith("CS-7");
  });

  it("omits the approval entry when the chapter is not a draft", () => {
    render(
      <ManuscriptChapterList
        workspaceId="w1"
        chapters={[
          {
            chapterId: "chapter-final-1",
            title: "第七章 定稿",
            blocks: [{ blockId: "§3-01-05", digest: "9e4b81ee", text: "定稿正文。" }],
          },
        ]}
        onOpenDraft={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "前往审批 →" })).not.toBeInTheDocument();
    expect(screen.getByText("第七章 定稿")).toBeInTheDocument();
  });

  it("omits the approval entry when no onOpenDraft handler is wired", () => {
    render(
      <ManuscriptChapterList
        workspaceId="w1"
        chapters={[
          {
            chapterId: "chapter-draft-2",
            title: "第一节 夜景",
            isDraft: true,
            changeSetId: "CS-8",
            blocks: [{ blockId: "§3-01-04", digest: "8f3a70", text: "" }],
          },
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: "前往审批 →" })).not.toBeInTheDocument();
  });
});
