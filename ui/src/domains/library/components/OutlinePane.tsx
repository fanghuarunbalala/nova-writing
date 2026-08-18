/**
 * OutlinePane
 *
 * 书库 · 大纲资料位（双栏）：左 = 幕级单元树（saga → arc/sequence，选中高亮）；
 * 右 = 选中单元详情（意图 / 梗概 / 人物与地点绑定 chips 跳对应档案 / 子·父单元）。
 * 数据 = bookOutline（includePlans——leaf 绑定）。
 */
import { useEffect, type ReactNode } from "react";
import { ListTree, MapPin, UserRound } from "lucide-react";
import type { StoryUnitWithLeaf } from "@novel/core";
import { Icon } from "../../../shared/primitives/Icon.js";
import { StatusChip } from "../../../shared/primitives/StatusChip.js";
import { EmptyState } from "../../../shared/primitives/EmptyState.js";
import { Spinner } from "../../../shared/primitives/Spinner.js";
import type { LibraryStore, LibrarySnapshot } from "../store/LibraryStore.js";
import styles from "./library.module.css";

export interface OutlinePaneProps {
	readonly bookId: string;
	readonly snapshot: LibrarySnapshot;
	readonly store: LibraryStore;
	/** 跳人物/地点档案（切资料位 + 选中） */
	readonly onOpenCharacter: (characterId: string) => void;
	readonly onOpenLocation: (locationId: string) => void;
}

/** 幕级 scope 展示标签（书库语境：sequence = 幕） */
const SCOPE_LABEL: Record<string, string> = {
	saga: "全书",
	arc: "卷弧",
	sequence: "幕",
	scene: "场景",
	custom: "自定义",
};

interface UnitNode {
	readonly unit: StoryUnitWithLeaf;
	readonly depth: number;
	readonly children: readonly UnitNode[];
}

/** parentId 树化（orderKey 排序；内部用可变数组构建，产出冻结只读树） */
function buildTree(units: readonly StoryUnitWithLeaf[]): readonly UnitNode[] {
	type MutableNode = { unit: StoryUnitWithLeaf; depth: number; children: MutableNode[] };
	const byId = new Map<string, MutableNode>();
	for (const unit of units) byId.set(unit.id, { unit, depth: 0, children: [] });
	const roots: MutableNode[] = [];
	for (const node of byId.values()) {
		const parent = node.unit.parentId !== undefined ? byId.get(node.unit.parentId) : undefined;
		if (parent !== undefined) parent.children.push(node);
		else roots.push(node);
	}
	const walk = (nodes: MutableNode[], depth: number): void => {
		nodes.sort((a, b) => a.unit.orderKey.localeCompare(b.unit.orderKey));
		for (const n of nodes) {
			n.depth = depth;
			walk(n.children, depth + 1);
		}
	};
	walk(roots, 0);
	const freeze = (n: MutableNode): UnitNode => ({
		unit: n.unit,
		depth: n.depth,
		children: Object.freeze(n.children.map(freeze)),
	});
	return Object.freeze(roots.map(freeze));
}

function flatten(nodes: readonly UnitNode[], out: UnitNode[] = []): readonly UnitNode[] {
	for (const n of nodes) {
		out.push(n);
		flatten(n.children, out);
	}
	return out;
}

export function OutlinePane({ bookId, snapshot, store, onOpenCharacter, onOpenLocation }: OutlinePaneProps) {
	const parts = snapshot.parts.get(bookId);
	useEffect(() => {
		void store.ensurePart(bookId, "outline");
		void store.ensurePart(bookId, "characters");
		void store.ensurePart(bookId, "locations");
	}, [store, bookId]);

	if (parts?.outline === undefined) {
		return snapshot.loading.has(`${bookId}:outline`) ? (
			<div className={styles.split}>
				<div className={styles.dirCol} />
				<div className={styles.detailCol}>
					<Spinner size="sm" />
				</div>
			</div>
		) : (
			<EmptyState icon={ListTree} title="大纲未就绪" description="幕级大纲由 BookAnalyst 解析产出——解析完成后自动可用。" />
		);
	}

	const units = parts.outline.units;
	if (units.length === 0) {
		return <EmptyState icon={ListTree} title="无幕级单元" description="解析未产出 story unit。" />;
	}
	const tree = buildTree(units);
	const flat = flatten(tree);
	const selected: UnitNode | undefined =
		flat.find((n) => n.unit.id === snapshot.unitId) ?? flat.find((n) => n.unit.scope === "sequence") ?? flat[0];
	if (selected === undefined) {
		return <EmptyState icon={ListTree} title="无幕级单元" description="解析未产出 story unit。" />;
	}
	const partsChars = parts.characters ?? [];
	const partsLocs = parts.locations ?? [];
	const entityName = (list: ReadonlyArray<{ id: string; name: string }>, id: string): string | undefined =>
		list.find((e) => e.id === id)?.name;
	const leafCharIds = selected.unit.leaf?.characters?.map((c) => c.characterId) ?? [];
	const leafLocIds = selected.unit.leaf?.locations?.map((l) => l.locationId) ?? [];
	const kids = selected.children;
	const parent = selected.unit.parentId !== undefined ? byIdOf(flat, selected.unit.parentId) : undefined;

	const row = (node: UnitNode): ReactNode => (
		<button
			key={node.unit.id}
			type="button"
			className={styles.row}
			data-active={node.unit.id === selected.unit.id}
			style={{ paddingLeft: `calc(var(--space-8px) + ${node.depth} * var(--space-4))` }}
			title={`${node.unit.title} · ${node.unit.orderKey}`}
			onClick={() => store.selectUnit(node.unit.id)}
		>
			<span className={styles.tick} aria-hidden="true" />
			<span className={styles.title}>{node.unit.title}</span>
			<StatusChip variant="faint" compact>
				{SCOPE_LABEL[node.unit.scope ?? "custom"] ?? "单元"}
			</StatusChip>
		</button>
	);

	/** 递归渲染单元树行（saga → arc/sequence → scene 全层级展开） */
	const rows = (node: UnitNode): ReactNode[] => [
		row(node),
		...node.children.flatMap((child) => rows(child)),
	];

	return (
		<div className={styles.split}>
			<div className={styles.dirCol}>
				{tree.flatMap(rows)}
			</div>
			<div className={styles.detailCol}>
				<div className={styles.paraCard}>
					<div className={styles.paraHead}>
						<StatusChip variant="accent">{SCOPE_LABEL[selected.unit.scope ?? "custom"] ?? "单元"}</StatusChip>
						<h3 style={{ margin: 0, fontSize: "var(--fs-h2)", fontWeight: "var(--fw-semibold)" }}>{selected.unit.title}</h3>
					</div>
					<div className={styles.chapterMeta}>
						storyUnit {selected.unit.id} · orderKey {selected.unit.orderKey}
						{parent !== undefined ? ` · 父 ${parent.unit.title}` : ""}
					</div>
					<p className={styles.progressNote} style={{ marginTop: "var(--space-2)" }}>
						意图 · intent
					</p>
					<p style={{ margin: 0, fontSize: "var(--fs-13)", lineHeight: 1.85 }}>{selected.unit.intent ?? "—"}</p>
					<p className={styles.progressNote} style={{ marginTop: "var(--space-2)" }}>
						梗概 · synopsis
					</p>
					<p style={{ margin: 0, fontSize: "var(--fs-13)", lineHeight: 1.85 }}>{selected.unit.synopsis ?? "—"}</p>
				</div>
				<div className={styles.paraCard}>
					<div className={styles.paraHead}>
						<span className={styles.mono}>关联 · leaf 绑定</span>
					</div>
					{leafCharIds.length > 0 ? (
						<div className={styles.refChips} style={{ marginBottom: "var(--space-2)" }}>
							{leafCharIds.map((id) => (
								<button key={id} type="button" className={styles.refChip} onClick={() => onOpenCharacter(id)}>
									<Icon icon={UserRound} size="xs" />
									{entityName(partsChars, id) ?? id}
								</button>
							))}
						</div>
					) : null}
					{leafLocIds.length > 0 ? (
						<div className={styles.refChips} style={{ marginBottom: "var(--space-2)" }}>
							{leafLocIds.map((id) => (
								<button key={id} type="button" className={styles.refChip} onClick={() => onOpenLocation(id)}>
									<Icon icon={MapPin} size="xs" />
									{entityName(partsLocs, id) ?? id}
								</button>
							))}
						</div>
					) : null}
					{kids.length > 0 ? (
						<div className={styles.refChips} style={{ marginBottom: "var(--space-2)" }}>
							{kids.map((k) => (
								<button key={k.unit.id} type="button" className={styles.refChip} onClick={() => store.selectUnit(k.unit.id)}>
									<Icon icon={ListTree} size="xs" />
									{k.unit.title}
								</button>
							))}
						</div>
					) : null}
					{parent !== undefined ? (
						<div className={styles.refChips}>
							<button type="button" className={styles.refChip} onClick={() => store.selectUnit(parent.unit.id)}>
								<Icon icon={ListTree} size="xs" />
								{parent.unit.title}
							</button>
						</div>
					) : null}
					{leafCharIds.length === 0 && leafLocIds.length === 0 && kids.length === 0 && parent === undefined ? (
						<p className={styles.progressNote} style={{ margin: 0 }}>
							该单元无 leaf 绑定记录。
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
}

function byIdOf(flat: readonly UnitNode[], id: string): UnitNode | undefined {
	return flat.find((n) => n.unit.id === id);
}
