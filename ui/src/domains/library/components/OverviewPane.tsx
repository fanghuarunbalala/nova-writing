/**
 * OverviewPane
 *
 * 书库 · 总览资料位：状态时间线（已导入→落库中→解析中→已完成/失败）+ 统计卡 +
 * 解构产物就绪位 + book.meta.json 元数据；解析中显示轮询提示，失败显示原因 + 重试。
 * 产物计数（幕/人物/地点）经部件懒加载填充。
 */
import { useEffect } from "react";
import { ArrowRight, Clock3 } from "lucide-react";
import type { BookSummary } from "@novel/core";
import { Icon } from "../../../shared/primitives/Icon.js";
import { Button } from "../../../shared/primitives/Button.js";
import { Spinner } from "../../../shared/primitives/Spinner.js";
import { StatusChip } from "../../../shared/primitives/StatusChip.js";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import type { LibraryStore, LibrarySnapshot } from "../store/LibraryStore.js";
import { formatChars } from "../viewModel.js";
import styles from "./library.module.css";

export interface OverviewPaneProps {
	readonly book: BookSummary;
	readonly snapshot: LibrarySnapshot;
	readonly store: LibraryStore;
	readonly onNotify: (kind: ToastKind, text: string) => void;
}

/** 状态时间线一步 */
function Step({ tone, label, pulse }: { tone: "success" | "warn" | "danger" | "neutral"; label: string; pulse?: boolean }) {
	return (
		<span className={styles.step} data-tone={tone}>
			{pulse === true ? <span className={styles.pulseDot} aria-hidden="true" /> : null}
			{label}
		</span>
	);
}

export function OverviewPane({ book, snapshot, store, onNotify }: OverviewPaneProps) {
	const parts = snapshot.parts.get(book.bookId);
	const progress = snapshot.progress.get(book.bookId);
	const outlineLoaded = parts?.outline !== undefined;
	const charactersLoaded = parts?.characters !== undefined;
	const locationsLoaded = parts?.locations !== undefined;
	const unitCount = parts?.outline?.units.filter((u) => u.scope !== "saga").length;

	// 已完成：拉幕/人物/地点计数（就绪位）
	useEffect(() => {
		if (book.status !== "已完成") return;
		void store.ensurePart(book.bookId, "outline");
		void store.ensurePart(book.bookId, "characters");
		void store.ensurePart(book.bookId, "locations");
	}, [store, book.bookId, book.status]);

	const handleRetry = async () => {
		try {
			const result = await store.retryAnalysis(book.bookId);
			onNotify("info", result.conversationId !== undefined ? `解析已启动：会话 ${result.conversationId} 运行中` : "解析已启动，进度见上方");
		} catch (err) {
			onNotify("danger", `启动解析失败：${err instanceof Error ? err.message : String(err)}`);
		}
	};

	const stats: ReadonlyArray<{ readonly num: string; readonly label: string; readonly note: string }> = [
		{ num: String(book.stats.volumes), label: "卷", note: book.stats.volumes > 0 ? "有卷标记" : "无卷标记" },
		{ num: String(book.stats.chapters), label: "章", note: "发布单位" },
		{ num: String(book.stats.batches), label: "分段", note: "目标 3500 字/批" },
		{ num: formatChars(book.stats.chars), label: "字数", note: "原文长度" },
		{ num: formatChars(book.stats.paragraphs), label: "自然段", note: "非空行计" },
	];

	return (
		<div>
			{book.status === "未解析" ? (
				<div className={styles.paraCard}>
					<div className={styles.paraHead}>
						<StatusChip variant="faint">未解析</StatusChip>
						<Button size="sm" variant="secondary" onClick={() => void handleRetry()}>
							开始解析
						</Button>
					</div>
					<p className={styles.progressNote}>
						仅导入完成：卷章 / 分段等确定性产物已就绪（正文资料位可读）。
						点「开始解析」派生 BookAnalyst 后台会话——产出幕级大纲 / 人物 / 地点 / 风格 / 摘录 / 好句好段。
					</p>
				</div>
			) : null}
			{book.status === "解析中" ? (
				<div className={styles.paraCard}>
					<div className={styles.progressRow}>
						<span className={styles.pulseDot} aria-hidden="true" />
						<b>BookAnalyst 后台会话运行中</b>
						<span className={styles.progressPercent}>
							{progress !== undefined && !progress.indeterminate ? `${progress.percent}%` : "…"}
						</span>
					</div>
					<div
						className={styles.progressBar}
						data-indeterminate={progress === undefined || progress.indeterminate ? "true" : "false"}
						role="progressbar"
						aria-valuenow={progress?.indeterminate === false ? progress.percent : undefined}
						aria-valuemin={0}
						aria-valuemax={100}
					>
						<div
							className={styles.progressFill}
							style={{
								width:
									progress !== undefined && !progress.indeterminate ? `${progress.percent}%` : undefined,
							}}
						/>
					</div>
					<p className={styles.progressNote}>
						{progress !== undefined && !progress.indeterminate
							? `已读 ${progress.coveredBatches}/${progress.totalBatches} 批 · 已建 ${progress.unitCount} 个故事单元 · 状态 3s 轮询，中断可恢复（journal 重放 + 断点续跑）`
							: "状态落 book.meta.json · 宿主 3s 轮询（走读不走推）；中断可恢复——journal 重放 + 断点续跑。完成后幕级大纲 / 人物 / 地点 / 风格 / 摘录自动就绪。"}
					</p>
				</div>
			) : null}
			{book.status === "解析失败" ? (
				<div className={styles.paraCard}>
					<div className={styles.paraHead}>
						<StatusChip variant="danger">解析失败</StatusChip>
						<Button size="sm" variant="secondary" onClick={() => void handleRetry()}>
							重试解析
						</Button>
					</div>
					<p className={styles.progressNote}>{book.statusReason ?? "（未记录原因）"}</p>
					<p className={styles.progressNote}>
						书目录已保留：卷章 / 分段等确定性产物仍可读，重试将复用并从断点续跑。
					</p>
				</div>
			) : null}

			<div className={styles.paraCard}>
				<div className={styles.paraHead}>
					<span className={styles.mono}>状态时间线</span>
					<span className={styles.mono} style={{ marginLeft: "auto" }}>
						<Icon icon={Clock3} size="xs" /> 导入于 {book.createdAt.slice(0, 16).replace("T", " ")} · 更新于{" "}
						{book.updatedAt.slice(0, 16).replace("T", " ")}
					</span>
				</div>
				<div className={styles.timeline}>
					<span className={styles.axisName}>状态</span>
					<Step tone="success" label="已导入" />
					<span className={styles.stepArrow}><Icon icon={ArrowRight} size="xs" /></span>
					<Step tone="success" label="落库中" />
					<span className={styles.stepArrow}><Icon icon={ArrowRight} size="xs" /></span>
					<Step
						tone={book.status === "解析中" ? "warn" : book.status === "未解析" ? "neutral" : "success"}
						label="解析中"
						pulse={book.status === "解析中"}
					/>
					<span className={styles.stepArrow}><Icon icon={ArrowRight} size="xs" /></span>
					<Step
						tone={book.status === "解析失败" ? "danger" : book.status === "未解析" ? "neutral" : "success"}
						label={book.status === "解析失败" ? "解析失败" : book.status === "未解析" ? "未解析" : "已完成"}
					/>
				</div>
			</div>

			<div className={styles.statGrid}>
				{stats.map((s) => (
					<div key={s.label} className={`${styles.paraCard} ${styles.statCard}`}>
						<div className={styles.num}>{s.num}</div>
						<div className={styles.label}>{s.label}</div>
						<div className={styles.note}>{s.note}</div>
					</div>
				))}
			</div>

			<div className={styles.paraCard}>
				<div className={styles.paraHead}>
					<span className={styles.mono}>解构产物</span>
				</div>
				<div className={styles.refChips}>
					<StatusChip variant={book.status === "已完成" ? "accent" : "faint"}>
						{book.status === "已完成" ? (outlineLoaded ? `幕级大纲 ${unitCount ?? 0}` : "幕级大纲 …") : "幕级大纲 未就绪"}
					</StatusChip>
					<StatusChip variant={book.status === "已完成" ? "accent" : "faint"}>
						{book.status === "已完成" ? (charactersLoaded ? `人物 ${parts?.characters?.length ?? 0}` : "人物 …") : "人物 未就绪"}
					</StatusChip>
					<StatusChip variant={book.status === "已完成" ? "accent" : "faint"}>
						{book.status === "已完成" ? (locationsLoaded ? `地点 ${parts?.locations?.length ?? 0}` : "地点 …") : "地点 未就绪"}
					</StatusChip>
					<StatusChip variant={book.hasStyle ? "success" : "faint"}>style.md {book.hasStyle ? "就绪" : "未产出"}</StatusChip>
					<StatusChip variant={book.hasExcerpt ? "success" : "faint"}>excerpts.md {book.hasExcerpt ? "就绪" : "未产出"}</StatusChip>
					{book.status === "已完成" && !(outlineLoaded && charactersLoaded && locationsLoaded) ? <Spinner size="xs" /> : null}
				</div>
			</div>

			<div className={styles.paraCard}>
				<div className={styles.paraHead}>
					<span className={styles.mono}>元数据 · book.meta.json</span>
				</div>
				<div className={styles.chapterMeta}>bookId：{book.bookId}</div>
				<div className={styles.chapterMeta}>
					源文件：{book.sourceFile}（source/ · ≤ 20 MiB · UTF-8 / GB18030 / Big5 探测）
				</div>
				<div className={styles.chapterMeta}>
					存储布局：&lt;书库根&gt;/{book.bookId}/ · book.meta.json · book.db · source/ · paragraphs/ · analysis/
				</div>
			</div>
		</div>
	);
}
