/**
 * ImportDialog
 *
 * 导入完本弹窗：源文件（宿主原生选择器 + 路径白名单）+ 书名（可选）+
 * 解析选项两档（导入并解析 / 仅导入）；结果与降级原因经 onNotify toast。
 */
import { useState } from "react";
import { FolderOpen, Upload } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import { Button } from "../../../shared/primitives/Button.js";
import { Dialog } from "../../../shared/primitives/Dialog.js";
import { Input } from "../../../shared/primitives/Input.js";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import type { LibraryStore, LibrarySnapshot } from "../store/LibraryStore.js";
import styles from "./library.module.css";

export interface ImportDialogProps {
	readonly snapshot: LibrarySnapshot;
	readonly store: LibraryStore;
	readonly onNotify: (kind: ToastKind, text: string) => void;
}

export function ImportDialog({ snapshot, store, onNotify }: ImportDialogProps) {
	const [title, setTitle] = useState("");
	const [analyze, setAnalyze] = useState(true);

	const handlePick = async () => {
		try {
			const path = await store.pickBookFile();
			if (path === undefined) onNotify("info", "已取消选择文件");
		} catch (err) {
			onNotify("danger", `文件选择失败：${err instanceof Error ? err.message : String(err)}`);
		}
	};

	const handleImport = async () => {
		if (snapshot.importSourcePath === undefined) {
			onNotify("info", "先选择源文件");
			return;
		}
		try {
			const result = await store.importBook({
				...(title.trim() !== "" ? { title: title.trim() } : {}),
				spawnAnalysis: analyze,
			});
			store.closeImport();
			setTitle("");
			const head = `已导入《${title.trim() !== "" ? title.trim() : "新书"}》：${result.stats.chapters} 章 · ${result.stats.batches} 批`;
			onNotify(
				"success",
				result.spawnSkipped !== undefined
					? `${head} · ${result.spawnSkipped}（总览页可随时开始解析）`
					: `${head} · 解析已在后台启动，进度见总览`,
			);
		} catch (err) {
			onNotify("danger", `导入失败：${err instanceof Error ? err.message : String(err)}`);
		}
	};

	return (
		<Dialog
			open={snapshot.importOpen}
			onOpenChange={(open) => (open ? store.openImport() : store.closeImport())}
			title="导入完本"
			footer={
				<>
					<Button variant="ghost" onClick={() => store.closeImport()}>
						取消
					</Button>
					<Button variant="primary" loading={snapshot.importBusy} onClick={() => void handleImport()}>
						<Icon icon={Upload} size="xs" />
						开始导入
					</Button>
				</>
			}
		>
			<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
				<label>
					<span className={styles.progressNote}>源文件（服务端文件 · ≤ 20 MiB · txt）</span>
					<div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2px)" }}>
						<Input
							readOnly
							value={snapshot.importSourcePath ?? ""}
							placeholder="经「选择文件」选取（路径经宿主白名单授权）"
						/>
						<Button variant="secondary" onClick={() => void handlePick()}>
							<Icon icon={FolderOpen} size="xs" />
							选择文件
						</Button>
					</div>
				</label>
				<label>
					<span className={styles.progressNote}>书名（可选 · 缺省取文件名去扩展）</span>
					<div style={{ marginTop: "var(--space-2px)" }}>
						<Input value={title} placeholder="例：雾中灯塔（完本）" onChange={(e) => setTitle(e.target.value)} />
					</div>
				</label>
				<div>
					<span className={styles.progressNote}>解析选项</span>
					<div style={{ marginTop: "var(--space-2px)" }}>
						<button type="button" className={styles.opt} data-on={analyze} onClick={() => setAnalyze(true)}>
							<span className={styles.radio} aria-hidden="true" />
							<span>
								<b className={styles.optTitle}>导入并解析</b>
								<small className={styles.optDesc}>
									导入后拉起 BookAnalyst 后台会话：幕级大纲 / 人物 / 地点 / 风格 / 摘录（需打开工作区并配置模型 provider，否则自动降级仅导入）。
								</small>
							</span>
						</button>
						<button type="button" className={styles.opt} data-on={!analyze} onClick={() => setAnalyze(false)}>
							<span className={styles.radio} aria-hidden="true" />
							<span>
								<b className={styles.optTitle}>仅导入</b>
								<small className={styles.optDesc}>
									确定性解析：卷章骨架 + 分段落盘 + manifest。不拉起解析会话，可稍后在总览触发。
								</small>
							</span>
						</button>
					</div>
				</div>
				<p className={styles.progressNote} style={{ margin: 0 }}>
					编码自动探测（UTF-8 / GB18030 / Big5）· 仅导入完成即确定就绪（可随时开始解析）· 成功自动授权当前工作区书单 · 失败整目录回滚
				</p>
			</div>
		</Dialog>
	);
}
