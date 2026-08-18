/**
 * LibrarySurface
 *
 * 书库视图主区表面（PRD app-redesign §8A，视觉对齐 demo v0.9）：MainSubHead
 * （状态 chip 在 context 位；动作按状态：失败→重试解析 / 已完成→在对话中引用；
 * 导入入口只在侧栏与空态）+ 七段资料位分段控件（总览 / 大纲 / 正文〔融合卷章〕/
 * 人物 / 地点 / 风格 / 摘录；解析产物位未完成时禁用）+ 分发（单栏居中 / 双栏）。
 * 风格/摘录的 pid 引用点击 → 正文定位高亮。
 */
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Feather, ListTree, MapPin, MessageSquare, Quote, ScrollText, UserRound, type LucideIcon } from "lucide-react";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import { Button } from "../../shared/primitives/Button.js";
import { EmptyState } from "../../shared/primitives/EmptyState.js";
import { Icon } from "../../shared/primitives/Icon.js";
import { LoadingState } from "../../shared/primitives/LoadingState.js";
import { StatusChip } from "../../shared/primitives/StatusChip.js";
import type { ToastKind } from "../../shared/state/ToastStore.js";
import type { LibraryStore, LibraryTab } from "../../domains/library/store/LibraryStore.js";
import { OverviewPane } from "../../domains/library/components/OverviewPane.js";
import { OutlinePane } from "../../domains/library/components/OutlinePane.js";
import { ManuscriptPane } from "../../domains/library/components/ManuscriptPane.js";
import { EntityPane } from "../../domains/library/components/EntityPane.js";
import { AnalysisPane } from "../../domains/library/components/AnalysisPane.js";
import { ImportDialog } from "../../domains/library/components/ImportDialog.js";
import { bookStatusChip } from "../../domains/library/viewModel.js";
import libStyles from "../../domains/library/components/library.module.css";
import { MainSubHead } from "./MainSubHead.js";
import styles from "./LibrarySurface.module.css";

export interface LibrarySurfaceProps {
	readonly library: LibraryStore;
	readonly onBack?: () => void;
	readonly onNotify?: (kind: ToastKind, text: string) => void;
}

/** 资料位定义（demo LIB_TABS：icon + 名称 + 计数；产物位解析完成才开放） */
interface PaneDef {
	readonly value: LibraryTab;
	readonly label: string;
	readonly icon: LucideIcon;
	readonly count?: number;
	readonly disabled: boolean;
}

export function LibrarySurface({ library, onBack, onNotify }: LibrarySurfaceProps) {
	const snapshot = useExternalStore(library);
	const [flashParagraphId, setFlashParagraphId] = useState<string | undefined>(undefined);
	const notify = onNotify ?? (() => {});

	// 定位高亮 1.2s 后消隐
	useEffect(() => {
		if (flashParagraphId === undefined) return;
		const timer = setTimeout(() => setFlashParagraphId(undefined), 1200);
		return () => clearTimeout(timer);
	}, [flashParagraphId]);

	const book = snapshot.books.find((b) => b.bookId === snapshot.selectedBookId) ?? snapshot.books[0];
	const ready = book !== undefined && book.status === "已完成";
	const parts = book !== undefined ? snapshot.parts.get(book.bookId) : undefined;

	const panes: readonly PaneDef[] = [
		{ value: "overview", label: "总览", icon: BookOpen, disabled: false },
		{
			value: "outline",
			label: "大纲",
			icon: ListTree,
			count: ready ? parts?.outline?.units.filter((u) => u.scope !== "saga").length : undefined,
			disabled: !ready,
		},
		{ value: "manuscript", label: "正文", icon: ScrollText, count: book?.stats.batches, disabled: false },
		{ value: "characters", label: "人物", icon: UserRound, count: ready ? parts?.characters?.length : undefined, disabled: !ready },
		{ value: "locations", label: "地点", icon: MapPin, count: ready ? parts?.locations?.length : undefined, disabled: !ready },
		{ value: "style", label: "风格", icon: Feather, disabled: !ready || book?.hasStyle !== true },
		{ value: "excerpt", label: "摘录", icon: Quote, disabled: !ready || book?.hasExcerpt !== true },
	];

	const handleRetry = async () => {
		if (book === undefined) return;
		try {
			const result = await library.retryAnalysis(book.bookId);
			notify("info", result.conversationId !== undefined ? `已重试解析：会话 ${result.conversationId} 运行中` : "已重试解析");
		} catch (err) {
			notify("danger", `重试失败：${err instanceof Error ? err.message : String(err)}`);
		}
	};

	/** pid → 正文定位（章 + 页 + 高亮）；跨资料位跳转入口统一走 store 选区 */
	const locateParagraph = (pid: string): void => {
		const manifest = parts?.manifest;
		if (manifest === undefined || book === undefined) {
			notify("info", `分段引用：${pid}`);
			return;
		}
		const index = manifest.findIndex((e) => e.id === pid);
		const entry = manifest[index];
		if (entry === undefined) {
			notify("danger", `未找到分段：${pid}`);
			return;
		}
		library.selectTab("manuscript");
		library.selectChapter(entry.chapterNo);
		const chapterStart = manifest.filter((e) => e.chapterNo === entry.chapterNo).findIndex((e) => e.id === pid);
		library.setPage(Math.floor(Math.max(0, chapterStart) / 6));
		setFlashParagraphId(pid);
	};

	const openUnit = (unitId: string): void => {
		library.selectTab("outline");
		library.selectUnit(unitId);
	};
	const openCharacter = (characterId: string): void => {
		library.selectTab("characters");
		library.selectCharacter(characterId);
	};
	const openLocation = (locationId: string): void => {
		library.selectTab("locations");
		library.selectLocation(locationId);
	};

	// tab 停在禁用项（解析完成后自动回总览交由用户再入）；渲染守卫
	const tab: LibraryTab = panes.some((p) => p.value === snapshot.tab && !p.disabled) ? snapshot.tab : "overview";
	const splitPane = tab === "outline" || tab === "manuscript" || tab === "characters" || tab === "locations";
	const centered =
		(snapshot.phase === "loading" && snapshot.books.length === 0) || snapshot.phase === "error" || book === undefined;

	let body: ReactNode = null;
	if (snapshot.phase === "loading" && snapshot.books.length === 0) {
		body = <LoadingState label="书单载入中" />;
	} else if (snapshot.phase === "error") {
		body = (
			<EmptyState
				icon={BookOpen}
				title="书单加载失败"
				description={snapshot.error?.message}
				action={
					<Button variant="secondary" onClick={() => void library.invalidate()}>
						重试
					</Button>
				}
			/>
		);
	} else if (book === undefined) {
		body = (
			<EmptyState
				icon={BookOpen}
				title="书单为空"
				description="全局书库跨工作区共享；工作区经 .novel/library.json 书单 opt-in（导入自动授权）。导入一本完本开始解构。"
				action={
					<Button variant="primary" onClick={() => library.openImport()}>
						导入完本
					</Button>
				}
			/>
		);
	} else if (tab === "overview") {
		body = <OverviewPane book={book} snapshot={snapshot} store={library} onNotify={notify} />;
	} else if (tab === "outline") {
		body = (
			<OutlinePane
				bookId={book.bookId}
				snapshot={snapshot}
				store={library}
				onOpenCharacter={openCharacter}
				onOpenLocation={openLocation}
			/>
		);
	} else if (tab === "manuscript") {
		body = (
			<ManuscriptPane
				book={book}
				snapshot={snapshot}
				store={library}
				onNotify={notify}
				flashParagraphId={flashParagraphId}
				onOpenUnit={openUnit}
			/>
		);
	} else if (tab === "characters" || tab === "locations") {
		body = <EntityPane bookId={book.bookId} kind={tab} snapshot={snapshot} store={library} onOpenUnit={openUnit} />;
	} else {
		body = <AnalysisPane bookId={book.bookId} which={tab} snapshot={snapshot} store={library} onLocateParagraph={locateParagraph} />;
	}

	return (
		<section className={styles.surface}>
			<MainSubHead
				title={book !== undefined ? `书库 · ${book.title}` : "书库"}
				sub={book !== undefined ? `${book.bookId} · ${book.sourceFile}` : "全局书库 · 跨工作区"}
				context={
				book !== undefined ? (
					<StatusChip variant={bookStatusChip(book.status)}>
						{book.status === "解析中"
							? (() => {
									const progress = snapshot.progress.get(book.bookId);
									return progress !== undefined && !progress.indeterminate
										? `解析中 ${progress.percent}%`
										: "解析中";
								})()
							: book.status}
					</StatusChip>
				) : undefined
			}
				onBack={onBack}
				actions={
					book !== undefined && book.status === "解析失败" ? (
						<Button size="sm" variant="secondary" onClick={() => void handleRetry()}>
							重试解析
					</Button>
					) : book !== undefined && book.status === "已完成" ? (
						<Button
							size="sm"
							variant="ghost"
							onClick={() =>
								notify(
									"info",
									"对话中主 Agent 经 library.read 工具可读该书：overview / paragraph / character / location / story_unit / volume / chapter / style / excerpt",
								)
							}
						>
							<Icon icon={MessageSquare} size="xs" />
							在对话中引用
						</Button>
					) : undefined
				}
			/>
			{book !== undefined ? (
				<div className={styles.tabsRow}>
					<div className={libStyles.paneTabs} role="tablist" aria-label="书库资料位">
						{panes.map((pane) => (
							<button
								key={pane.value}
								type="button"
								role="tab"
								aria-selected={tab === pane.value}
								disabled={pane.disabled}
								title={pane.disabled ? "解析完成后可用" : undefined}
								className={libStyles.paneTab}
								onClick={() => library.selectTab(pane.value)}
							>
								<Icon icon={pane.icon} size="sm" />
								<span>{pane.label}</span>
								{pane.count !== undefined ? <span className={libStyles.paneTabCount}>{pane.count}</span> : null}
							</button>
						))}
					</div>
				</div>
			) : null}
			<div className={styles.paneBody}>
				{centered ? (
					<div className={styles.paneCenter}>{body}</div>
				) : splitPane ? (
					body
				) : (
					<div className={styles.paneScroll}>
						<div className={styles.paneInner}>{body}</div>
					</div>
				)}
			</div>
			<ImportDialog snapshot={snapshot} store={library} onNotify={notify} />
		</section>
	);
}
