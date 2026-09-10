/**
 * EntityPane
 *
 * 书库 · 人物/地点资料位（双栏，kind 复用）：左 = 解构实体列表；右 = 档案
 * （名称 / 别名 / 简介 / 初始状态 / 作者备注）+ 关联幕反查（经 leaf 绑定）。
 */
import { useEffect } from "react";
import { ListTree, MapPin, UserRound } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import { Avatar } from "../../../shared/primitives/Avatar.js";
import { EmptyState } from "../../../shared/primitives/EmptyState.js";
import { Spinner } from "../../../shared/primitives/Spinner.js";
import type { LibraryStore, LibrarySnapshot } from "../store/LibraryStore.js";
import styles from "./library.module.css";

export interface EntityPaneProps {
	readonly bookId: string;
	readonly kind: "characters" | "locations";
	readonly snapshot: LibrarySnapshot;
	readonly store: LibraryStore;
	/** 跳大纲单元详情（关联幕 chip） */
	readonly onOpenUnit: (unitId: string) => void;
}

export function EntityPane({ bookId, kind, snapshot, store, onOpenUnit }: EntityPaneProps) {
	const parts = snapshot.parts.get(bookId);
	useEffect(() => {
		void store.ensurePart(bookId, kind);
		void store.ensurePart(bookId, "outline");
	}, [store, bookId, kind]);

	const entities = parts?.[kind];
	if (entities === undefined) {
		return snapshot.loading.has(`${bookId}:${kind}`) ? (
			<Spinner size="sm" />
		) : (
			<EmptyState
				icon={kind === "characters" ? UserRound : MapPin}
				title={kind === "characters" ? "人物档案未就绪" : "地点档案未就绪"}
				description="书库实体与创作库同构（Character / Location），由 BookAnalyst 解析写入每书 book.db。"
			/>
		);
	}
	if (entities.length === 0) {
		return (
			<EmptyState
				icon={kind === "characters" ? UserRound : MapPin}
				title={kind === "characters" ? "无人物档案" : "无地点档案"}
				description="解析未产出该类实体（或该书未预置）。"
			/>
		);
	}

	const selectedId = kind === "characters" ? snapshot.charId : snapshot.locId;
	const selected = entities.find((e) => e.id === selectedId) ?? entities[0];
	if (selected === undefined) {
		return (
			<EmptyState
				icon={kind === "characters" ? UserRound : MapPin}
				title={kind === "characters" ? "无人物档案" : "无地点档案"}
				description="解析未产出该类实体（或该书未预置）。"
			/>
		);
	}
	const units = parts?.outline?.units ?? [];
	const relatedUnits = units.filter(
		(u) =>
			u.leaf?.characters?.some((c) => c.characterId === selected.id) ||
			u.leaf?.locations?.some((l) => l.locationId === selected.id),
	);

	return (
		<div className={styles.split}>
			<div className={styles.dirCol}>
				{entities.map((e) => (
					<button
						key={e.id}
						type="button"
						className={styles.row}
						data-active={e.id === selected.id}
						onClick={() =>
							kind === "characters" ? store.selectCharacter(e.id) : store.selectLocation(e.id)
						}
					>
						{kind === "characters" ? (
							<Avatar variant="user" text={e.name.slice(0, 1)} />
						) : (
							<span className={styles.iconBox}>
								<Icon icon={MapPin} size="xs" />
							</span>
						)}
						<span className={styles.text}>
							<span className={styles.title}>{e.name}</span>
							<span className={styles.subtitle}>{e.aliases.length > 0 ? e.aliases.join(" / ") : "—"}</span>
						</span>
					</button>
				))}
			</div>
			<div className={styles.detailCol}>
				<div className={styles.paraCard}>
					<div className={styles.paraHead}>
						{kind === "characters" ? <Avatar variant="user" text={selected.name.slice(0, 1)} /> : null}
						<h3 style={{ margin: 0, fontSize: "var(--fs-h2)", fontWeight: "var(--fw-semibold)" }}>{selected.name}</h3>
						<span className={styles.mono}>
							{kind === "characters" ? "人物" : "地点"} · 书库解构 · v{selected.entityVersion}
						</span>
					</div>
					{selected.aliases.length > 0 ? (
						<div className={styles.chapterMeta}>别名：{selected.aliases.join(" / ")}</div>
					) : null}
					<p style={{ marginTop: "var(--space-2)", fontSize: "var(--fs-13)", lineHeight: 1.85 }}>
						{selected.summary ?? "（无简介）"}
					</p>
					{selected.initialState !== undefined ? (
						<p className={styles.progressNote} style={{ marginTop: "var(--space-2)" }}>
							初始状态：{selected.initialState}
						</p>
					) : null}
					{selected.authorNotes !== undefined ? (
						<p className={styles.progressNote} style={{ marginTop: "var(--space-2)" }}>
							备注：{selected.authorNotes}
						</p>
					) : null}
				</div>
				<div className={styles.paraCard}>
					<div className={styles.paraHead}>
						<span className={styles.mono}>关联幕</span>
					</div>
					{relatedUnits.length > 0 ? (
						<div className={styles.refChips}>
							{relatedUnits.map((u) => (
								<button key={u.id} type="button" className={styles.refChip} onClick={() => onOpenUnit(u.id)}>
									<Icon icon={ListTree} size="xs" />
									{u.title}
								</button>
							))}
						</div>
					) : (
						<p className={styles.progressNote} style={{ margin: 0 }}>
							未绑定——该实体未出现在任何幕的 leaf 绑定中。
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
