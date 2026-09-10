/**
 * AnalysisPane
 *
 * 书库 · 风格/摘录资料位：md 摘要渲染（## 小节 + 段落）；正文中的 paragraph id
 * 引用渲染为可点 pid chip —— 点击跳正文资料位对应章/页并高亮（写 id 契约）。
 */
import { useEffect } from "react";
import { Feather, Quote } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import { EmptyState } from "../../../shared/primitives/EmptyState.js";
import { Spinner } from "../../../shared/primitives/Spinner.js";
import type { LibraryStore, LibrarySnapshot } from "../store/LibraryStore.js";
import styles from "./library.module.css";

export interface AnalysisPaneProps {
	readonly bookId: string;
	readonly which: "style" | "excerpt";
	readonly snapshot: LibrarySnapshot;
	readonly store: LibraryStore;
	/** pid 引用点击 → 定位正文（章/页 + 高亮） */
	readonly onLocateParagraph: (pid: string) => void;
}

const PID_RE = /bk_[a-z0-9]+-p\d{6}/g;

export function AnalysisPane({ bookId, which, snapshot, store, onLocateParagraph }: AnalysisPaneProps) {
	const parts = snapshot.parts.get(bookId);
	useEffect(() => {
		void store.ensurePart(bookId, which);
		void store.ensurePart(bookId, "manifest");
	}, [store, bookId, which]);

	const content = parts?.[which];
	if (content === undefined) {
		return snapshot.loading.has(`${bookId}:${which}`) ? (
			<Spinner size="sm" />
		) : (
			<EmptyState
				icon={which === "style" ? Feather : Quote}
				title={which === "style" ? "风格档案未就绪" : "特色摘录未就绪"}
				description={`${which === "style" ? "analysis/style.md" : "analysis/excerpts.md"} 由 BookAnalyst 收尾写入。`}
			/>
		);
	}

	// 行渲染：## 小节标题；段内 pid 引用 → 可点 chip
	const renderLine = (line: string, key: number): React.ReactNode => {
		if (line.startsWith("## ")) {
			return <h4 key={key}>{line.slice(3)}</h4>;
		}
		const segments = line.split(PID_RE);
		const pids = line.match(PID_RE) ?? [];
		return (
			<p key={key}>
				{segments.map((seg, i) => (
					<span key={`s${String(i)}`}>
						{seg}
						{i < pids.length ? (
							<button
								type="button"
								className={styles.pid}
								style={{ margin: "0 var(--space-2px)" }}
								title={`跳到正文分段：${pids[i]}`}
								onClick={() => onLocateParagraph(pids[i]!)}
							>
								<Icon icon={Quote} size="xs" />
								{pids[i]}
							</button>
						) : null}
					</span>
				))}
			</p>
		);
	};

	return (
		<div>
			<div className={styles.paraCard} style={{ marginBottom: "var(--space-3)" }}>
				<p className={styles.progressNote} style={{ margin: 0 }}>
					写 id 契约：引用正文一律 paragraph id（点引用跳到正文分段），不复制长段原文；单次返回上限 20,000 字符
					{content.truncated ? "（当前内容已截断）" : ""}。
				</p>
			</div>
			<div className={`${styles.paraCard} ${styles.analysis}`}>
				{content.content.split(/\r?\n/).map((line, i) => (line.trim() === "" ? null : renderLine(line, i)))}
			</div>
		</div>
	);
}
