/**
 * ManuscriptPane
 *
 * 书库 · 正文资料位（双栏，融合卷章）：左 = 卷章目录（卷组 + 章行，当前章高亮）；
 * 右 = 章头（卷名 · publication id · 来源幕提示——大纲/卷章解耦）+ 分段批卡片
 * （paragraph id 契约 chip 点击复制）+ 分页（单页 6 批护栏）。
 */
import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Copy, Layers, ListTree, ScrollText } from "lucide-react";
import type { BookSummary } from "@novel/core";
import { Icon } from "../../../shared/primitives/Icon.js";
import { Button } from "../../../shared/primitives/Button.js";
import { EmptyState } from "../../../shared/primitives/EmptyState.js";
import { Spinner } from "../../../shared/primitives/Spinner.js";
import { StatusChip } from "../../../shared/primitives/StatusChip.js";
import { LIBRARY_PAGE_SIZE, type LibraryStore, type LibrarySnapshot } from "../store/LibraryStore.js";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import styles from "./library.module.css";

export interface ManuscriptPaneProps {
	readonly book: BookSummary;
	readonly snapshot: LibrarySnapshot;
	readonly store: LibraryStore;
	readonly onNotify: (kind: ToastKind, text: string) => void;
	/** 定位高亮的分段 id（风格/摘录引用跳入） */
	readonly flashParagraphId: string | undefined;
	readonly onOpenUnit: (unitId: string) => void;
}

export function ManuscriptPane({ book, snapshot, store, onNotify, flashParagraphId, onOpenUnit }: ManuscriptPaneProps) {
	const bookId = book.bookId;
	const parts = snapshot.parts.get(bookId);

	useEffect(() => {
		void store.ensurePart(bookId, "manifest");
		void store.ensurePart(bookId, "publication");
		if (book.status === "已完成") void store.ensurePart(bookId, "outline");
	}, [store, bookId, book.status]);

	useEffect(() => {
		void store.ensureParagraphs(bookId, snapshot.chapterNo, snapshot.page);
	}, [store, bookId, snapshot.chapterNo, snapshot.page]);

	if (parts?.manifest === undefined) {
		return (
			<EmptyState
				icon={ScrollText}
				title={snapshot.loading.has(`${bookId}:manifest`) ? "分段索引载入中" : "分段未就绪"}
				description={snapshot.loading.has(`${bookId}:manifest`) ? undefined : "manifest 由导入时的确定性解析生成。"}
			/>
		);
	}

	const manifest = parts.manifest;
	const chapters = [...new Set(manifest.map((e) => e.chapterNo))].sort((a, b) => a - b);
	const chapterNo = chapters.includes(snapshot.chapterNo) ? snapshot.chapterNo : (chapters[0] ?? 1);
	const publication = parts.publication;
	const chapterMeta = publication?.chapters[Math.min(chapterNo, publication.chapters.length) - 1];
	const volume = publication?.volumes.find((v) => v.id === chapterMeta?.volumeId);
	const batchesByChapter = new Map<number, number>();
	for (const entry of manifest) {
		batchesByChapter.set(entry.chapterNo, (batchesByChapter.get(entry.chapterNo) ?? 0) + 1);
	}
	const page = snapshot.parts.get(bookId)?.paragraphs.get(chapterNo);
	const totalPages = Math.max(1, Math.ceil((page?.total ?? batchesByChapter.get(chapterNo) ?? 1) / LIBRARY_PAGE_SIZE));
	const sourceUnit =
		chapterMeta?.storyUnitId !== undefined
			? parts.outline?.units.find((u) => u.id === chapterMeta.storyUnitId)
			: undefined;

	// 左栏：卷组 + 章行（卷内归组；无卷 = 全书一卷）
	const volumeGroups =
		publication !== undefined && publication.volumes.length > 0
			? publication.volumes.map((v) => ({
					volume: v,
					chapterNos: [...new Set(manifest.filter((e) => publication.chapters[e.chapterNo - 1]?.volumeId === v.id).map((e) => e.chapterNo))],
				}))
			: [{ volume: undefined, chapterNos: chapters }];

	const chapterRow = (no: number): React.ReactNode => (
		<button
			key={no}
			type="button"
			className={styles.row}
			data-active={no === chapterNo}
			style={{ paddingLeft: "var(--space-6)" }}
			title={manifest.find((e) => e.chapterNo === no)?.chapterTitle ?? `第 ${no} 章`}
			onClick={() => store.selectChapter(no)}
		>
			<span className={styles.statusDot} aria-hidden="true" />
			<span className={styles.text}>
				<span className={styles.title}>{manifest.find((e) => e.chapterNo === no)?.chapterTitle ?? `第 ${no} 章`}</span>
				<span className={styles.subtitle}>{batchesByChapter.get(no) ?? 0} 批</span>
			</span>
		</button>
	);

	const handleCopyPid = async (pid: string) => {
		try {
			await navigator.clipboard.writeText(pid);
			onNotify("info", `已复制分段 id：${pid}（写 id 契约：引用正文一律 paragraph id）`);
		} catch {
			onNotify("info", `分段 id：${pid}`);
		}
	};

	return (
		<div className={styles.split}>
			<div className={styles.dirCol}>
				{volumeGroups.map((g, i) => (
					<div key={g.volume?.id ?? `flat-${String(i)}`}>
						<div className={styles.groupHead}>
							<Icon icon={Layers} size="xs" />
							{g.volume?.title ?? "无卷标记 · 全书一卷"}
							<span className={styles.count}>{g.chapterNos.length}</span>
						</div>
						{g.chapterNos.map(chapterRow)}
					</div>
				))}
			</div>
			<div className={styles.detailCol}>
				<div className={styles.readerColumn}>
				<div className={styles.chapterTitle}>
					<h3>{manifest.find((e) => e.chapterNo === chapterNo)?.chapterTitle ?? `第 ${chapterNo} 章`}</h3>
					<StatusChip variant="accent" compact>
						{batchesByChapter.get(chapterNo) ?? 0} 批
					</StatusChip>
				</div>
				<div className={styles.chapterMeta}>
					{volume?.title ?? "无卷标记 · 全书一卷"}
					{chapterMeta !== undefined ? ` · publication ${chapterMeta.id}` : ""} · 单次 {LIBRARY_PAGE_SIZE} 批（护栏上限 24）
				</div>
				<div className={styles.refChips} style={{ margin: "var(--space-2) 0" }}>
					<span className={styles.progressNote}>来源幕</span>
					{sourceUnit !== undefined ? (
						<button type="button" className={styles.refChip} onClick={() => onOpenUnit(sourceUnit.id)}>
							<Icon icon={ListTree} size="xs" />
							{sourceUnit.title}
						</button>
					) : (
						<StatusChip variant="faint" compact>
							{chapterMeta?.storyUnitId !== undefined ? "溯源中" : "未溯源"}
						</StatusChip>
					)}
					{sourceUnit !== undefined ? <span className={styles.progressNote}>仅来源提示（大纲/卷章解耦）</span> : null}
				</div>
				<div className={styles.paraFoot}>
					<span>
						第 {snapshot.page * LIBRARY_PAGE_SIZE + 1}–{Math.min(page?.total ?? 0, (snapshot.page + 1) * LIBRARY_PAGE_SIZE)} 批 /
						本章 {page?.total ?? batchesByChapter.get(chapterNo) ?? 0} 批 · 全书 {manifest.length} 批
					</span>
					<span className={styles.grow} />
					<Button size="sm" variant="ghost" disabled={snapshot.page <= 0} onClick={() => store.setPage(snapshot.page - 1)}>
						<Icon icon={ChevronLeft} size="xs" />上一页
					</Button>
					<Button size="sm" variant="ghost" disabled={snapshot.page >= totalPages - 1} onClick={() => store.setPage(snapshot.page + 1)}>
						下一页<Icon icon={ChevronRight} size="xs" />
					</Button>
				</div>
				{page === undefined ? (
					<Spinner size="sm" />
				) : (
					page.items.map((entry) => (
						<div key={entry.id} className={styles.paraCard} data-flash={flashParagraphId === entry.id}>
							<div className={styles.paraHead}>
								<button type="button" className={styles.pid} title="点击复制分段 id" onClick={() => void handleCopyPid(entry.id)}>
									<Icon icon={Copy} size="xs" />
									{entry.id}
								</button>
								<span className={styles.mono}>
									{entry.chars} 字 · {entry.chapterTitle}
								</span>
								<span className={styles.mono} style={{ marginLeft: "auto" }}>
									{entry.file}
								</span>
							</div>
							{entry.text.split(/\n\n/).map((p, i) => (
								<p key={i}>{p}</p>
							))}
						</div>
					))
				)}
				</div>
			</div>
		</div>
	);
}
