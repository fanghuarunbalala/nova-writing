/**
 * manuscript 子域测试。
 *
 * 正文视图以权威 publication 结构（卷 → 章）为目录，正文文本随加载一次到位：
 * store 读 publication.get（卷/章含 paragraphIds 选择）+ paragraphs.list 全量，
 * 按选择顺序组装 Volume→Chapter 层级（blocks 直接带全文，digest 短码置空）。
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
      paragraphIds: ["§3-01-04", "§3-01-05"],
    },
    {
      id: "chapter_two",
      entityVersion: 1,
      volumeId: "volume_one",
      orderKey: "2000",
      title: "第二章 雨夜",
      paragraphIds: ["§3-01-06"],
    },
    {
      id: "chapter_three",
      entityVersion: 1,
      volumeId: "volume_two",
      orderKey: "1000",
      title: "第三章 新篇",
      paragraphIds: [],
    },
  ],
};

function paragraph(id: string, storyUnitId: string, orderKey: string, text = ""): Paragraph {
  return { id, entityVersion: 1, storyUnitId, orderKey, text };
}

const allParagraphs: readonly Paragraph[] = [
  paragraph("§3-01-04", "su-1", "0001"),
  paragraph("§3-01-05", "su-1", "0002"),
  paragraph("§3-01-06", "su-2", "0003"),
];

interface ManuscriptApiOverrides {
  readonly publication?: Partial<NovelApiClient["novel"]["publication"]>;
  readonly paragraphs?: Partial<NovelApiClient["novel"]["paragraphs"]>;
  readonly mutate?: NovelApiClient["novel"]["mutate"];
  readonly mutateBatch?: NovelApiClient["novel"]["mutateBatch"];
}

function buildApi(overrides: ManuscriptApiOverrides = {}): NovelApiClient {
  return {
    conversations: {} as never,
    novel: {
      overview: {} as never,
      outline: {} as never,
      characters: {} as never,
      locations: {} as never,
      // 裸 mutate 在 insertParagraph 新路径中不应被触达（stale 须整批回滚而非留孤儿）
      mutate:
        overrides.mutate ??
        (vi.fn(async () => {
          throw new Error("unexpected bare mutate");
        }) as never),
      mutateBatch: overrides.mutateBatch ?? (vi.fn(async () => []) as never),
      paragraphs: {
        list: vi.fn(async () => [...allParagraphs]),
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

  it("auto-selects the first chapter and joins paragraph texts by selection", async () => {
    const api = buildApi({
      paragraphs: {
        list: vi.fn(async () => [
          paragraph("§3-01-06", "su-2", "0003", ""),
          paragraph("§3-01-04", "su-1", "0001", "第一行\n第二行"),
          paragraph("§3-01-05", "su-1", "0002", "第二段正文。"),
        ]),
      },
    });
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().selectedChapterId).toBe("chapter_one");
    const chapter = store.getSnapshot().chapters[0];
    expect(chapter.blocks[0].text).toBe("第一行\n第二行");
    expect(chapter.blocks[1].text).toBe("第二段正文。");
    // 全量一次拉取（不再按单元多次）
    expect(api.novel.paragraphs.list).toHaveBeenCalledTimes(1);
  });

  it("switches the selected chapter via selectChapter", async () => {
    const api = buildApi({
      paragraphs: {
        list: vi.fn(async () => [
          paragraph("§3-01-04", "su-1", "0001", "段落"),
          paragraph("§3-01-05", "su-1", "0002", "段落"),
          paragraph("§3-01-06", "su-2", "0003", "雨落得密。"),
        ]),
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

  it("insertParagraph: 插段 + 追加章选择合并为单个 mutateBatch（客户端预生成 id，无裸 mutate）", async () => {
    const mutateBatch = vi.fn(async () => [
      { version: 1, changeId: "ignored", entity: "paragraph" },
      { version: 2, changeId: "chapter_one", entity: "publication" },
    ]) as unknown as NovelApiClient["novel"]["mutateBatch"];
    const api = buildApi({ mutateBatch });
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    await store.insertParagraph("chapter_one", "新段落正文。");

    expect(api.novel.mutateBatch).toHaveBeenCalledTimes(1);
    const batch = (api.novel.mutateBatch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(2);
    const [insert, update] = batch;
    expect(insert.op).toBe("paragraph.insert");
    expect(insert.id).toMatch(/^para_/); // 客户端预生成（两步无结果依赖，可并入单批）
    expect(insert.text).toBe("新段落正文。");
    expect(insert.storyUnitId).toBe("su-1"); // 挂靠章选择末段（§3-01-05）所在单元
    expect(update.op).toBe("publication.chapter.update");
    expect(update.baseRevision).toBe(1);
    expect(update.patch).toEqual({
      paragraphIds: ["§3-01-04", "§3-01-05", insert.id],
    });
  });

  it("insertParagraph: 批 stale 整批回滚（不留孤儿段落）并重拉最新供重试", async () => {
    const mutateBatch = vi.fn(async () => {
      throw Object.assign(new Error("stale"), { code: "stale" });
    }) as unknown as NovelApiClient["novel"]["mutateBatch"];
    const api = buildApi({ mutateBatch });
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    await store.insertParagraph("chapter_one", "新段落正文。");

    expect(api.novel.mutateBatch).toHaveBeenCalledTimes(1); // 仅一次批调用，失败即整批回滚（无第二步裸 mutate）
    expect(api.novel.publication.get).toHaveBeenCalledTimes(2); // stale → 自动重拉最新（stale 提示随重拉被 ready 覆盖）
    expect(store.getSnapshot().phase).toBe("ready");
  });

  it("keeps per-unit paragraph index (incl. unpublished) and preserves selectedChapterId on reload", async () => {
    const api = buildApi({
      paragraphs: {
        list: vi.fn(async () => [
          paragraph("§3-01-04", "su-1", "0001", "第一段"),
          paragraph("§3-01-05", "su-1", "0002", "第二段"),
          paragraph("§3-01-06", "su-2", "0003", "第三段"),
          paragraph("para_draft", "su-2", "0004", "挂在单元但未入选任何章的段落"),
        ]),
      },
    });
    const store = new ManuscriptStructureStore({ api });
    await store.loadWorkspace("w1");
    const snapshot = store.getSnapshot();
    // 单元分组：大纲详情「单元段落」数据源（含未发布段落）
    expect(snapshot.unitParagraphs.get("su-1")?.map((p) => p.paragraphId)).toEqual(["§3-01-04", "§3-01-05"]);
    expect(snapshot.unitParagraphs.get("su-2")?.map((p) => p.paragraphId)).toEqual(["§3-01-06", "para_draft"]);
    expect(snapshot.publishedParagraphIds.has("para_draft")).toBe(false); // 未入选任何章
    expect(snapshot.publishedParagraphIds.has("§3-01-04")).toBe(true);
    // 事件失效重载保留选中章（agent 写入不把阅读器跳回第一章）
    store.selectChapter("chapter_two");
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().selectedChapterId).toBe("chapter_two");
  });
});

describe("ManuscriptReader", () => {
  it("renders the selected chapter reading area (no inner TOC) with volume meta", () => {
    render(
      <ManuscriptReader
        workspaceId="w1"
        snapshot={readerSnapshot()}
        volumeTitleOf={(chapterId) => (chapterId === "chapter_two" ? "第一卷" : undefined)}
      />,
    );
    // MS-1：主区为纯阅读区（卷章目录在内容视图左栏），无内层目录导航。
    expect(screen.queryByRole("navigation", { name: "章节目录" })).not.toBeInTheDocument();
    // selectedChapterId=chapter_two → 阅读区显示该章。
    expect(screen.getByText("第二章 雨夜")).toBeInTheDocument();
    // 章头 mono 元信息行带卷名（段落文本为空 → 字数不计入）。
    expect(screen.getByText("第一卷")).toBeInTheDocument();
  });

  it("falls back to the first chapter when none is selected", () => {
    const snapshot = readerSnapshot();
    render(
      <ManuscriptReader
        workspaceId="w1"
        snapshot={{ ...snapshot, selectedChapterId: undefined }}
      />,
    );
    expect(screen.getByText("第一章 序章")).toBeInTheDocument();
  });

  it("shows the blocked banner and kai empty state for a blocked chapter", () => {
    render(
      <ManuscriptReader
        workspaceId="w1"
        snapshot={readerSnapshot()}
        chapterStatusOf={(chapterId) =>
          chapterId === "chapter_two"
            ? { realization: "blocked", blockedReason: "等待第 1 章定稿", abandonedReason: undefined }
            : undefined
        }
      />,
    );
    expect(screen.getByText("本章受阻：等待第 1 章定稿")).toBeInTheDocument();
    expect(screen.getByText("等上游定稿，这一章就能落笔。")).toBeInTheDocument();
  });

  it("shows the not-started kai empty state for a chapter without blocks", () => {
    const snapshot = readerSnapshot();
    const emptyChapter = { ...snapshot.chapters[1], blocks: [], paragraphIds: [] };
    render(
      <ManuscriptReader
        workspaceId="w1"
        snapshot={{
          ...snapshot,
          chapters: [snapshot.chapters[0], emptyChapter],
          selectedChapterId: "chapter_two",
        }}
      />,
    );
    expect(screen.getByText("此章尚未落笔——从一句话开始，让故事自己生长。")).toBeInTheDocument();
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
    const entry = screen.getByRole("button", { name: "前往审批" });
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
    expect(screen.queryByRole("button", { name: "前往审批" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "前往审批" })).not.toBeInTheDocument();
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

  it("renders a loading placeholder while text is empty, without block chrome", () => {
    render(<ManuscriptBlock block={{ blockId: "§3-01-04", digest: "8f3a70", text: "" }} />);
    // MS-3 口径：段落无常显 blockId/digest 头。
    expect(screen.queryByText("§3-01-04")).not.toBeInTheDocument();
    expect(screen.getByText("（正文加载中…）")).toBeInTheDocument();
  });

  it("renders the draft block trailing tag (MS-4)", () => {
    render(
      <ManuscriptBlock
        block={{ blockId: "§3-01-04", digest: "8f3a70", text: "草稿段落。", isDraft: true }}
      />,
    );
    expect(screen.getByText("草稿 · 未转入正式稿")).toBeInTheDocument();
  });
});
