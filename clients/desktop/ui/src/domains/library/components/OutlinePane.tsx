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
import { composeTitle, hasOrdinalPrefix, ordinalOfPath } from "../../novel/outline/projection/StoryOutlineTreeProjection.js";
import { formatSynopsisDisplay } from "../../novel/outline/outlineStatus.js";
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

/** 幕级 scope 展示标签（展示层统称「幕」，场景为最底层） */
const SCOPE_LABEL: Record<string, string> = {
	saga: "全书",
	arc: "幕",
	sequence: "幕",
	scene: "场景",
	custom: "自定义",
};

/** leaf 节奏拍类型标签（rhythm 枚举 → 中文） */
const RHYTHM_LABEL: Record<string, string> = {
	setup: "铺垫",
	climax: "高潮",
	resolution: "收束",
	transition: "过渡",
};

/**
 * synopsis 覆盖区间脱敏（共享实现见 outlineStatus.formatSynopsisDisplay）：
 * 「（覆盖 <bookId>-pXXXXXX–pYYYYYY）」→「（覆盖正文 pXXXXXX–pYYYYYY）」。
 */
function formatSynopsis(synopsis: string | null | undefined): string {
	if (synopsis == null) return "—";
	return formatSynopsisDisplay(synopsis);
}

interface UnitNode {
	readonly unit: StoryUnitWithLeaf;
	readonly depth: number;
	readonly ordinal: string;
	readonly overDepth: boolean;
	readonly children: readonly UnitNode[];
}

/** parentId 树化（orderKey 排序 + 序号标注；内部用可变数组构建，产出冻结只读树） */
function buildTree(units: readonly StoryUnitWithLeaf[]): readonly UnitNode[] {
	type MutableNode = { unit: StoryUnitWithLeaf; depth: number; ordinal: string; overDepth: boolean; children: MutableNode[] };
	const byId = new Map<string, MutableNode>();
	for (const unit of units) byId.set(unit.id, { unit, depth: 0, ordinal: "", overDepth: false, children: [] });
	const roots: MutableNode[] = [];
	for (const node of byId.values()) {
		const parent = node.unit.parentId !== undefined ? byId.get(node.unit.parentId) : undefined;
		if (parent !== undefined) parent.children.push(node);
		else roots.push(node);
	}
	roots.sort((a, b) => a.unit.orderKey.localeCompare(b.unit.orderKey));
	/**
	 * 数字路径标注：saga 根为 []（全书）；游离顶层根为 [i]（序数兜底）；
	 * 其余节点 = 父路径 + 兄弟序。段数 1 → 中文序数，≥2 → 点分，>3 → 超深。
	 */
	const assign = (n: MutableNode, depth: number, p: readonly number[]): void => {
		n.depth = depth;
		if (p.length === 0) {
			n.ordinal = "全书";
			n.overDepth = false;
		} else {
			const o = ordinalOfPath(p);
			n.ordinal = o.ordinal;
			n.overDepth = o.overDepth;
		}
		n.children.sort((a, b) => a.unit.orderKey.localeCompare(b.unit.orderKey));
		n.children.forEach((child, index) => assign(child, depth + 1, [...p, index + 1]));
	};
	roots.forEach((root, index) => {
		assign(root, 0, root.unit.scope === "saga" ? [] : [index + 1]);
	});
	const freeze = (n: MutableNode): UnitNode => ({
		unit: n.unit,
		depth: n.depth,
		ordinal: n.ordinal,
		overDepth: n.overDepth,
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
	const leaf = selected.unit.leaf;
	const leafTime = typeof leaf?.time === "string" ? leaf.time : leaf?.time?.description;
	const leafEvents = [...(leaf?.events ?? [])].sort((a, b) =>
		(a.orderKey ?? "").localeCompare(b.orderKey ?? ""),
	);
	const leafBeats = [...(leaf?.rhythmBeats ?? [])].sort((a, b) =>
		(a.orderKey ?? "").localeCompare(b.orderKey ?? ""),
	);
	const leafChanges = leaf?.entityChanges ?? [];
	const kids = selected.children;
	const parent = selected.unit.parentId !== undefined ? byIdOf(flat, selected.unit.parentId) : undefined;

	const row = (node: UnitNode): ReactNode => (
		<button
			key={node.unit.id}
			type="button"
			className={styles.row}
			data-active={node.unit.id === selected.unit.id}
			style={{ paddingLeft: `calc(var(--space-8px) + ${node.depth} * var(--space-4))` }}
			title={node.unit.title}
			onClick={() => store.selectUnit(node.unit.id)}
		>
			<span className={styles.tick} aria-hidden="true" />
			<span className={styles.title}>{composeTitle(node.ordinal, node.unit.title)}</span>
			<StatusChip variant="faint" compact>
				{SCOPE_LABEL[node.unit.scope ?? "custom"] ?? "单元"}
			</StatusChip>
			{hasOrdinalPrefix(node.unit.title) ? (
				<StatusChip variant="danger" compact title="标题自带编号前缀（编号由界面按结构动态生成），建议改为纯标题">
					含编号
				</StatusChip>
			) : null}
			{node.overDepth ? (
				<StatusChip variant="danger" compact title="层级超过 4 层（全书 → 幕 → 幕 → 场景），建议整理">
					超深
				</StatusChip>
			) : null}
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
						<h3 style={{ margin: 0, fontSize: "var(--fs-h2)", fontWeight: "var(--fw-semibold)" }}>{composeTitle(selected.ordinal, selected.unit.title)}</h3>
					</div>
					<div className={styles.chapterMeta}>
						{parent !== undefined ? `父 ${composeTitle(parent.ordinal, parent.unit.title)}` : "顶层单元"}
						{selected.overDepth ? " · 层级超过 4 层（全书 → 幕 → 幕 → 场景），建议整理" : ""}
					</div>
					<p className={styles.progressNote} style={{ marginTop: "var(--space-2)" }}>
						意图
					</p>
					<p style={{ margin: 0, fontSize: "var(--fs-13)", lineHeight: 1.85 }}>{selected.unit.intent ?? "—"}</p>
					<p className={styles.progressNote} style={{ marginTop: "var(--space-2)" }}>
						梗概
					</p>
					<p style={{ margin: 0, fontSize: "var(--fs-13)", lineHeight: 1.85 }}>{formatSynopsis(selected.unit.synopsis)}</p>
				</div>
				<div className={styles.paraCard}>
					<div className={styles.paraHead}>
						<span className={styles.mono}>场景计划</span>
					</div>
					{leafTime !== undefined && leafTime !== "" ? (
						<div className={styles.chapterMeta} style={{ marginBottom: "var(--space-6px)" }}>
							时间：{leafTime}
						</div>
					) : null}
					{leafEvents.length > 0 ? (
						<>
							<p className={styles.progressNote} style={{ margin: "0 0 var(--space-6px)" }}>事件序列</p>
							<ol style={{ margin: 0, paddingLeft: "var(--space-5)", fontSize: "var(--fs-13)", lineHeight: 1.85 }}>
								{leafEvents.map((e) => (
									<li key={e.id} style={{ marginBottom: "var(--space-2px)" }}>{e.description}</li>
								))}
							</ol>
						</>
					) : null}
					{leafBeats.length > 0 ? (
						<>
							<p className={styles.progressNote} style={{ margin: "var(--space-2) 0 var(--space-6px)" }}>
								节奏拍（读者情绪）
							</p>
							<ul style={{ margin: 0, paddingLeft: "var(--space-5)", fontSize: "var(--fs-13)", lineHeight: 1.85, listStyle: "none" }}>
								{leafBeats.map((b) => (
									<li key={b.id} style={{ marginBottom: "var(--space-2px)" }}>
										<StatusChip variant="accent" compact>{RHYTHM_LABEL[b.rhythm] ?? b.rhythm}</StatusChip>{" "}
										{b.description}
										{b.readerEmotion !== undefined ? `（读者：${b.readerEmotion}）` : ""}
									</li>
								))}
							</ul>
						</>
					) : null}
					{leafChanges.length > 0 ? (
						<>
							<p className={styles.progressNote} style={{ margin: "var(--space-2) 0 var(--space-6px)" }}>状态变更</p>
							<ul style={{ margin: 0, paddingLeft: "var(--space-5)", fontSize: "var(--fs-13)", lineHeight: 1.85, listStyle: "none" }}>
								{leafChanges.map((c) => (
									<li key={c.id} style={{ marginBottom: "var(--space-2px)" }}>· {c.summary}</li>
								))}
							</ul>
						</>
					) : null}
					{leafCharIds.length > 0 ? (
						<div className={styles.refChips} style={{ marginBottom: "var(--space-2)" }}>
							{leafCharIds.map((id) => (
								<button key={id} type="button" className={styles.refChip} onClick={() => onOpenCharacter(id)}>
									<Icon icon={UserRound} size="xs" />
									{entityName(partsChars, id) ?? "未知角色"}
								</button>
							))}
						</div>
					) : null}
					{leafLocIds.length > 0 ? (
						<div className={styles.refChips} style={{ marginBottom: "var(--space-2)" }}>
							{leafLocIds.map((id) => (
								<button key={id} type="button" className={styles.refChip} onClick={() => onOpenLocation(id)}>
									<Icon icon={MapPin} size="xs" />
									{entityName(partsLocs, id) ?? "未知地点"}
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
					{leaf === undefined &&
					leafCharIds.length === 0 &&
					leafLocIds.length === 0 &&
					leafEvents.length === 0 &&
					leafBeats.length === 0 &&
					leafChanges.length === 0 &&
					kids.length === 0 &&
					parent === undefined ? (
						<p className={styles.progressNote} style={{ margin: 0 }}>
							该单元暂无场景计划（全书与幕级通常没有；最底层场景应由细化或解析产出）。
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
