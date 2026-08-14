/**
 * manuscript 子域测试。
 *
 * 正文视图以权威 publication 结构（卷 → 章）为目录，正文文本随加载一次到位：
 * store 读 publication.get（卷/章），按章 storyUnitId 批量读 paragraphs.list
 * （全文返回）组装 Volume→Chapter 层级（blocks 直接带全文，digest 短码置空）。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NovelApiClient, Paragraph, PublicationSnapshot } from "@novel/core";
import { ManuscriptStructureStore } from "../../../src/domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { ManuscriptStructureSnapshot } from "../../../src/domains/novel/manuscript/store/ManuscriptStructureStore.js";
import { ManuscriptReader } from "../../../src/domains/novel/manuscript/components/ManuscriptReader.js";
import { ManuscriptChapterContent } from "../../../src/domains/novel/manuscript/components/ManuscriptChapterContent.js";
import { ManuscriptBlock } from "../../../src/domains/novel/manuscript/components/ManuscriptBlock.js";
import { ManuscriptDraftTag } from "../../../src/domains/novel/manuscript/components/ManuscriptDraftTag.js";

const publication: PublicationSnapshot = {
  structure: { id: "publication_main", novelId: "novel_1" },
  volumes: [
    { id: "volume_one", entityVersion: 1, orderKey: "1000", title: "第一卷" },
    { id: "volume_two", entityVersion: 1, orderKey: "2000", title: "第二卷" },
  ],
  chapters: [
    {
      id: "chapter_one",
      entityVersion: 1,
      volumeId: "volume_one",
      orderKey: "1000",
      title: "第一章 序章",
      storyUnitId: "su-1",
    },
    {
      id: "chapter_two",
      entityVersion: 1,
      volumeId: "volume_one",
      orderKey: "2000",
      title: "第二章 雨夜",
      storyUnitId: "su-2",
    },
    {
      id: "chapter_three",
      entityVersion: 1,
      volumeId: "volume_two",
      orderKey: "1000",
      title: "第三章 新篇",
    },
  ],
};

function paragraph(id: string, storyUnitId: string, orderKey: string, text = ""): Paragraph {
  return { id, entityVersion: 1, storyUnitId, orderKey, text };
}

const paragraphsByUnit: Readonly<Record<string, readonly Paragraph[]>> = {
  "su-1": [paragraph("§3-01-04", "su-1", "0001"), paragraph("§3-01-05", "su-1", "0002")],
  "su-2": [paragraph("§3-01-06", "su-2", "0003")],
};

interface ManuscriptApiOverrides {
  readonly publication?: Partial<NovelApiClient["novel"]["publication"]>;
  readonly paragraphs?: Partial<NovelApiClient["novel"]["paragraphs"]>;
}

function buildApi(overrides: ManuscriptApiOverrides = {}): NovelApiClient {
  return {
    conversations: {} as never,
    novel: {
      overview: {} as never,
      outline: {} as never,
      characters: {} as never,
      locations: {} as never,
      paragraphs: {
        list: vi.fn(async (storyUnitId: unknown) => [
          ...(paragraphsByUnit[String(storyUnitId)] ?? []),
        ]),
        get: vi.fn(async () => undefined),
        ...overrides.paragraphs,
      },
      publication: {
        get: vi.fn(async () => publication),
        ...overrides.publication,
      },
    },
  } as unknown as NovelApiClient;
}

function readerSnapshot(): ManuscriptStructureSnapshot {
  return {
    phase: "ready",
    workspaceId: "w1",
    volumes: [
      Object.freeze({
        volumeId: "volume_one",
        title: "第一卷",
        chapters: Object.freeze([
          Object.freeze({
            chapterId: "chapter_one",
            volumeId: "volume_one",
            title: "第一章 序章",
            paragraphIds: ["p-1"],
            blocks: Object.freeze([{ blockId: "p-1", digest: "aaaaaa", text: "" }]),
          }),
          Object.freeze({
            chapterId: "chapter_two",
            volumeId: "volume_one",
            title: "第二章 雨夜",
            paragraphIds: ["p-2"],
            blocks: Object.freeze([{ blockId: "p-2", digest: "bbbbbb", text: "" }]),
          }),
        ]),
      }),
    ],
    chapters: Object.freeze([
      {
        chapterId: "chapter_one",
        volumeId: "volume_one",
        title: "第一章 序章",
        paragraphIds: ["p-1"],
        blocks: [{ blockId: "p-1", digest: "aaaaaa", text: "" }],
      },
      {
        chapterId: "chapter_two",
        volumeId: "volume_one",
        title: "第二章 雨夜",
        paragraphIds: ["p-2"],
        blocks: [{ blockId: "p-2", digest: "bbbbbb", text: "" }],
      },
    ]),
    selectedChapterId: "chapter_two",
    error: undefined,
  };
}

describe("ManuscriptStructureStore", () => {
  it("builds the Volume → Chapter hierarchy and joins blocks from the paragraph catalog", async () => {
    const api = buildApi();
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.volumes.map((volume) => volume.title)).toEqual(["第一卷", "第二卷"]);
    expect(snapshot.volumes[0].chapters.map((chapter) => chapter.chapterId)).toEqual([
      "chapter_one",
      "chapter_two",
    ]);
    expect(snapshot.volumes[1].chapters.map((chapter) => chapter.chapterId)).toEqual([
      "chapter_three",
    ]);
    expect(snapshot.chapters).toHaveLength(3);
    expect(snapshot.chapters[0].title).toBe("第一章 序章");
    expect(snapshot.chapters[0].blocks.map((block) => block.blockId)).toEqual([
      "§3-01-04",
      "§3-01-05",
    ]);
    expect(snapshot.chapters[0].blocks[0]).toMatchObject({
      blockId: "§3-01-04",
      digest: "",
      text: "",
      storyUnitId: "su-1",
    });
    expect(snapshot.chapters[2].blocks).toHaveLength(0);
    expect(snapshot.selectedChapterId).toBe("chapter_one");
  });

  it("auto-selects the first chapter and joins paragraph texts by story unit", async () => {
    const api = buildApi({
      paragraphs: {
        list: vi.fn(async (storyUnitId: unknown) => {
          if (storyUnitId === "su-1") {
            return [
              paragraph("§3-01-04", "su-1", "0001", "第一行\n第二行"),
              paragraph("§3-01-05", "su-1", "0002", "第二段正文。"),
            ];
          }
          return [paragraph("§3-01-06", "su-2", "0003", "")];
        }),
      },
    });
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().selectedChapterId).toBe("chapter_one");
    const chapter = store.getSnapshot().chapters[0];
    expect(chapter.blocks[0].text).toBe("第一行\n第二行");
    expect(chapter.blocks[1].text).toBe("第二段正文。");
    expect(api.novel.paragraphs.list).toHaveBeenCalledTimes(2);
  });

  it("switches the selected chapter via selectChapter", async () => {
    const api = buildApi({
      paragraphs: {
        list: vi.fn(async (storyUnitId: unknown) =>
          storyUnitId === "su-2"
            ? [paragraph("§3-01-06", "su-2", "0003", "雨落得密。")]
            : [paragraph("§3-01-04", "su-1", "0001", "段落"), paragraph("§3-01-05", "su-1", "0002", "段落")],
        ),
      },
    });
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().selectedChapterId).toBe("chapter_one");
    store.selectChapter("chapter_two");
    expect(store.getSnapshot().selectedChapterId).toBe("chapter_two");
    expect(store.getSnapshot().chapters[1].blocks[0].text).toBe("雨落得密。");
  });

  it("reports an empty ready state when the publication has no volumes or chapters", async () => {
    const api = buildApi({
      publication: {
        get: vi.fn(async () => ({
          structure: { id: "publication_main", novelId: "novel_1" },
          volumes: [],
          chapters: [],
        })),
      },
    });
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.volumes).toHaveLength(0);
    expect(snapshot.chapters).toHaveLength(0);
    expect(snapshot.selectedChapterId).toBeUndefined();
  });

  it("records a retryable error when the publication fetch fails", async () => {
    const api = buildApi({
      publication: {
        get: vi.fn(async () => {
          throw new Error("down");
        }),
      },
    });
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().phase).toBe("error");
    expect(store.getSnapshot().error?.retryable).toBe(true);
  });
});

describe("ManuscriptReader", () => {
  it("renders volume and chapter titles in the TOC and selects a chapter on click", async () => {
    const user = userEvent.setup();
    const onSelectChapter = vi.fn();
    render(
      <ManuscriptReader
        workspaceId="w1"
        snapshot={readerSnapshot()}
        onSelectChapter={onSelectChapter}
      />,
    );
    expect(screen.getByRole("navigation", { name: "章节目录" })).toBeInTheDocument();
    expect(screen.getByText("第一卷")).toBeInTheDocument();
    // selectedChapterId=chapter_two → content pane shows it; 序章 appears only in TOC
    expect(screen.getByText("第一章 序章")).toBeInTheDocument();
    await user.click(screen.getByText("第一章 序章"));
    expect(onSelectChapter).toHaveBeenCalledWith("chapter_one");
  });

  it("shows an empty state when there are no chapters", () => {
    render(
      <ManuscriptReader
        workspaceId="w1"
        snapshot={{
          phase: "ready",
          workspaceId: "w1",
          volumes: [],
          chapters: [],
          selectedChapterId: undefined,
          error: undefined,
        }}
        onSelectChapter={vi.fn()}
      />,
    );
    expect(
      screen.getByText("暂无卷章结构，请先在写作工具中创建卷章"),
    ).toBeInTheDocument();
  });

  it("shows the error message in the error phase", () => {
    render(
      <ManuscriptReader
        workspaceId="w1"
        snapshot={{
          phase: "error",
          workspaceId: "w1",
          volumes: [],
          chapters: [],
          selectedChapterId: undefined,
          error: {
            code: "novel-load-failed",
            message: "正文结构加载失败，请重试",
            retryable: true,
          },
        }}
        onSelectChapter={vi.fn()}
      />,
    );
    expect(screen.getByText("正文结构加载失败，请重试")).toBeInTheDocument();
  });
});

describe("ManuscriptChapterContent", () => {
  it("shows the 前往审批 entry on draft chapters and invokes onOpenDraft", async () => {
    const user = userEvent.setup();
    const onOpenDraft = vi.fn();
    render(
      <ManuscriptChapterContent
        chapter={{
          chapterId: "chapter-draft-1",
          volumeId: "volume_one",
          title: "第一节 夜景",
          isDraft: true,
          changeSetId: "CS-7",
          paragraphIds: [],
          blocks: [],
        }}
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
      <ManuscriptChapterContent
        chapter={{
          chapterId: "chapter-final-1",
          volumeId: "volume_one",
          title: "第七章 定稿",
          paragraphIds: [],
          blocks: [],
        }}
        onOpenDraft={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "前往审批 →" })).not.toBeInTheDocument();
    expect(screen.getByText("第七章 定稿")).toBeInTheDocument();
  });

  it("omits the approval entry when no onOpenDraft handler is wired", () => {
    render(
      <ManuscriptChapterContent
        chapter={{
          chapterId: "chapter-draft-2",
          volumeId: "volume_one",
          title: "第一节 夜景",
          isDraft: true,
          changeSetId: "CS-8",
          paragraphIds: [],
          blocks: [],
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: "前往审批 →" })).not.toBeInTheDocument();
  });
});

describe("manuscript block primitives", () => {
  it("renders a paragraph text preserving internal line breaks", () => {
    const { container } = render(
      <ManuscriptBlock
        block={{ blockId: "§3-01-04", digest: "8f3a70", text: "第一行\n第二行" }}
      />,
    );
    const text = container.querySelector("p.text");
    expect(text).not.toBeNull();
    if (text === null) return;
    // 未按 \n 拆分成多个元素：raw textContent 仍含换行 → 行分割由 CSS pre-wrap 呈现
    expect(text.textContent).toBe("第一行\n第二行");
    expect(text).toHaveStyle({ whiteSpace: "pre-wrap" });
  });

  it("renders a loading placeholder while text is empty", () => {
    render(<ManuscriptBlock block={{ blockId: "§3-01-04", digest: "8f3a70", text: "" }} />);
    expect(screen.getByText("§3-01-04")).toBeInTheDocument();
    expect(screen.getByText("（正文加载中…）")).toBeInTheDocument();
  });

  it("renders the draft tag", () => {
    render(<ManuscriptDraftTag />);
    expect(screen.getByText("草稿")).toBeInTheDocument();
  });
});
