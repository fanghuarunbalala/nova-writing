/**
 * manuscript 子域测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NovelApiClient, NovelManuscriptStructureSnapshot } from "@novel/core";
import { ManuscriptStructureStore } from "../../../src/domains/novel/manuscript/store/ManuscriptStructureStore.js";
import { ManuscriptChapterList } from "../../../src/domains/novel/manuscript/components/ManuscriptChapterList.js";
import { ManuscriptBlock } from "../../../src/domains/novel/manuscript/components/ManuscriptBlock.js";
import { ManuscriptDraftTag } from "../../../src/domains/novel/manuscript/components/ManuscriptDraftTag.js";

const structure: NovelManuscriptStructureSnapshot = {
  schemaVersion: 1,
  scope: { kind: "canonical" },
  publication: {
    publication: { id: "pub_1", novelId: "novel_1" },
    volumes: [],
    chapters: [
      { id: "chapter-301", publicationId: "pub_1", volumeId: "v1", orderKey: "0001", title: "Chapter 7" },
    ],
  },
  manuscript: { id: "ms_1", novelId: "novel_1", publicationId: "pub_1" },
  blocks: [
    { id: "§3-01-04", chapterId: "chapter-301", orderKey: "0001", textLength: 120, textDigest: "8f3a70ff" },
  ],
};

function buildApi(overrides: Partial<NovelApiClient["novel"]["manuscript"]> = {}): NovelApiClient {
  return {
    conversations: {} as never,
    novel: {
      overview: {} as never,
      outline: {} as never,
      characters: {} as never,
      locations: {} as never,
      manuscript: {
        getStructure: vi.fn(async () => structure),
        getBlock: vi.fn(),
        ...overrides,
      },
    },
  } as unknown as NovelApiClient;
}

describe("ManuscriptStructureStore", () => {
  it("maps chapters and block summaries", async () => {
    const api = buildApi();
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.chapters).toHaveLength(1);
    expect(snapshot.chapters[0].title).toBe("Chapter 7");
    expect(snapshot.chapters[0].blocks[0]).toMatchObject({
      blockId: "§3-01-04",
      digest: "8f3a70",
      text: "",
    });
  });

  it("records a retryable error on failure", async () => {
    const api = buildApi({
      getStructure: vi.fn(async () => {
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
    render(<ManuscriptDraftTag revision="r042" />);
    expect(screen.getByText("r042")).toBeInTheDocument();
  });
});
