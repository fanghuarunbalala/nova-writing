/**
 * LibraryDirectory
 *
 * 书库视图侧栏（PRD §8A LB-1）：书单目录（书行 = 图标/解析中脉冲 + 书名 + 章数字数
 * + 状态 chip）+ 导入按钮 + 空态引导（无书 / 服务未装配）。
 */
import { BookOpen, Upload } from "lucide-react";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import { Button } from "../../../shared/primitives/Button.js";
import { StatusChip } from "../../../shared/primitives/StatusChip.js";
import { EmptyState } from "../../../shared/primitives/EmptyState.js";
import { LoadingState } from "../../../shared/primitives/LoadingState.js";
import type { LibraryStore } from "../../../domains/library/store/LibraryStore.js";
import { bookStatusChip, bookSubtitle } from "../../../domains/library/viewModel.js";
import { DirectoryHead } from "./DirectoryHead.js";
import styles from "./LibraryDirectory.module.css";

export interface LibraryDirectoryProps {
	readonly store: LibraryStore;
}

export function LibraryDirectory({ store }: LibraryDirectoryProps) {
	const snapshot = useExternalStore(store);
	const importButton = (
		<Button size="sm" variant="primary" onClick={() => store.openImport()}>
			<Icon icon={Upload} size="xs" />
			导入
		</Button>
	);

	if (snapshot.phase === "loading" && snapshot.books.length === 0) {
		return <LoadingState label="书单载入中" />;
	}
	if (snapshot.phase === "error") {
		return (
			<EmptyState
				icon={BookOpen}
				title="书库不可用"
				description={snapshot.error?.message ?? "书单加载失败"}
				action={
					<Button variant="secondary" onClick={() => void store.invalidate()}>
						重试
					</Button>
				}
			/>
		);
	}

	return (
		<div className={styles.section}>
			<DirectoryHead label="书单" count={snapshot.books.length} tools={importButton} />
			<div className={styles.list}>
				{snapshot.books.map((book) => (
					<button
						key={book.bookId}
						type="button"
						className={styles.row}
						data-active={book.bookId === snapshot.selectedBookId}
						title={`${book.title} · ${book.bookId}`}
						onClick={() => store.selectBook(book.bookId)}
					>
						{book.status === "解析中" ? (
							<span className={styles.pulseDot} aria-hidden="true" />
						) : (
							<span className={styles.iconBox}>
								<Icon icon={BookOpen} size="xs" />
							</span>
						)}
						<span className={styles.text}>
							<span className={styles.title}>{book.title}</span>
							<span className={styles.subtitle}>{bookSubtitle(book.stats)}</span>
						</span>
						<StatusChip variant={bookStatusChip(book.status)} compact>
							{book.status}
						</StatusChip>
					</button>
				))}
				{snapshot.books.length === 0 ? (
					<p className={styles.empty}>
						书单为空——全局书库跨工作区共享，工作区经 .novel/library.json 书单 opt-in（导入自动授权）。
					</p>
				) : (
					<p className={styles.legend}>
						导入 = 确定性解析（卷章 + 分段）；幕级大纲 / 风格 / 摘录由 BookAnalyst 后台会话产出
					</p>
				)}
			</div>
		</div>
	);
}
