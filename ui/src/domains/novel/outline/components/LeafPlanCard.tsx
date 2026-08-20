/**
 * LeafPlanCard
 *
 * 场景计划 leaf 卡（demo app-redesign leafHTML）：场景级故事设计文档——
 * 场景模式/时间 + 人物·地点绑定 chips（id→名称解析 + 参与/在场标签）+
 * 事件序列（mono 编号）+ 节奏拍 chips（节拍·强度·读者情绪）+ 实体变更
 * 列表（类别前缀 + 摘要）。leaf 内部 id（事件/拍/变更 id、orderKey、
 * relatedEventIds、sourceEventIds）一律不上屏。
 *
 * 大纲单元详情面板与审批面板（写入内容/当前内容段）共用；RefChip 亦供
 * 关联 chips 复用（跳转回调可选，纯展示时渲染 span）。
 */
import type { ReactNode } from "react";
import { MapPin, ScrollText, UserRound, type LucideIcon } from "lucide-react";
import type { LeafPlan } from "@novel/core";
import { Icon, StatusChip } from "../../../../shared/primitives/index.js";
import {
  LEAF_CHANGE_LABEL,
  LEAF_LOC_ROLE_LABEL,
  LEAF_PRESENCE_LABEL,
  LEAF_RHYTHM_LABEL,
  LEAF_ROLE_LABEL,
} from "../outlineStatus.js";
import styles from "./LeafPlanCard.module.css";

/** 实体名称查找（leaf chips 显示角色/地点名；兼容 id→名称直映射与 {name} 结构） */
export interface LeafEntityLookup {
  readonly name: string;
}

export type LeafNameMap = ReadonlyMap<string, string | LeafEntityLookup>;

function lookupName(map: LeafNameMap | undefined, id: string): string {
  const hit = map?.get(id);
  return typeof hit === "string" ? hit : (hit?.name ?? "未知实体");
}

/** 引用 chip：图标 + 名称 + 附加标签；有 onClick 渲染 button，否则 span。 */
export function RefChip({
  icon,
  label,
  tag,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  tag?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <Icon icon={icon} size="xs" />
      {label}
      {tag !== undefined && tag !== "" ? <small className={styles.refTag}>{tag}</small> : null}
    </>
  );
  return onClick !== undefined ? (
    <button type="button" className={styles.refChip} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={styles.refChip}>{body}</span>
  );
}

/**
 * 宽松形状校验 + 归一（审批参数区拿到的是 JSON 值，非 core 实例）：
 * 核心数组键齐全才视为 leaf；缺失字段补缺省、非对象项丢弃，枚举值保留
 * 原文（渲染处 ?? 原文兜底），不做白名单过滤。
 */
export function coerceLeafPlan(value: unknown): LeafPlan | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.rhythmBeats) || !Array.isArray(raw.entityChanges)) return undefined;
  const objects = (list: unknown): readonly Record<string, unknown>[] =>
    Array.isArray(list) ? list.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
  const strings = (list: unknown): readonly string[] =>
    Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  const optString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const optInvolvement = (v: unknown) =>
    typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
  return {
    settingMode: raw.settingMode === "location-independent" ? "location-independent" : "located",
    time: {
      description: optInvolvement(raw.time) !== undefined
        ? optString((optInvolvement(raw.time) as Record<string, unknown>).description) ?? ""
        : "",
    },
    characters: objects(raw.characters).map((b) => {
      const involvement = optInvolvement(b.involvement);
      return {
        characterId: optString(b.characterId) ?? "",
        ...(involvement !== undefined
          ? { involvement: { presence: optString(involvement.presence) ?? "present", roles: strings(involvement.roles) } }
          : {}),
        ...(optString(b.note) !== undefined ? { note: optString(b.note) } : {}),
      };
    }) as unknown as LeafPlan["characters"],
    locations: objects(raw.locations).map((b) => {
      const involvement = optInvolvement(b.involvement);
      return {
        locationId: optString(b.locationId) ?? "",
        ...(involvement !== undefined
          ? { involvement: { role: optString(involvement.role) ?? "primary", affected: involvement.affected === true } }
          : {}),
        ...(optString(b.note) !== undefined ? { note: optString(b.note) } : {}),
      };
    }) as unknown as LeafPlan["locations"],
    events: objects(raw.events).map((e) => ({
      id: optString(e.id) ?? "",
      orderKey: optString(e.orderKey) ?? "",
      description: optString(e.description) ?? "",
    })),
    rhythmBeats: objects(raw.rhythmBeats).map((b) => ({
      id: optString(b.id) ?? "",
      orderKey: optString(b.orderKey) ?? "",
      rhythm: optString(b.rhythm) as LeafPlan["rhythmBeats"][number]["rhythm"],
      intensity: typeof b.intensity === "number" ? b.intensity : 0,
      ...(optString(b.readerEmotion) !== undefined ? { readerEmotion: optString(b.readerEmotion) } : {}),
      ...(optString(b.pointOfViewEmotion) !== undefined
        ? { pointOfViewEmotion: optString(b.pointOfViewEmotion) }
        : {}),
      relatedEventIds: strings(b.relatedEventIds),
    })) as LeafPlan["rhythmBeats"],
    entityChanges: objects(raw.entityChanges).map((c) => ({
      id: optString(c.id) ?? "",
      entityType: (c.entityType === "location" ? "location" : "character") as LeafPlan["entityChanges"][number]["entityType"],
      entityId: optString(c.entityId) ?? "",
      ...(optString(c.relatedEntityId) !== undefined ? { relatedEntityId: optString(c.relatedEntityId) } : {}),
      category: optString(c.category) as LeafPlan["entityChanges"][number]["category"],
      summary: optString(c.summary) ?? "",
      sourceEventIds: strings(c.sourceEventIds),
    })) as LeafPlan["entityChanges"],
  };
}

export interface LeafPlanCardProps {
  readonly leaf: LeafPlan | undefined;
  readonly characterNames?: LeafNameMap;
  readonly locationNames?: LeafNameMap;
  readonly onOpenCharacter?: (characterId: string) => void;
  readonly onOpenLocation?: (locationId: string) => void;
}

/** 场景计划 leaf 卡（仅 scene 叶单元；demo leafHTML）。 */
export function LeafPlanCard({
  leaf,
  characterNames,
  locationNames,
  onOpenCharacter,
  onOpenLocation,
}: LeafPlanCardProps) {
  if (leaf === undefined) {
    return (
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>场景计划</h3>
        <div className={`${styles.banner} ${styles.faint}`}>
          <Icon icon={ScrollText} size="sm" />
          <span>leaf 未编写——写场景前先补场景设计：人物 / 地点绑定、事件序列、节奏拍、实体变更。</span>
        </div>
      </div>
    );
  }
  const charChips = leaf.characters.map((binding) => {
    const involvement = binding.involvement;
    const tag =
      involvement !== undefined
        ? [
            involvement.roles.map((role) => LEAF_ROLE_LABEL[role] ?? role).join("/"),
            LEAF_PRESENCE_LABEL[involvement.presence] ?? involvement.presence,
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
    return (
      <RefChip
        key={binding.characterId}
        icon={UserRound}
        label={lookupName(characterNames, binding.characterId)}
        tag={tag}
        onClick={
          onOpenCharacter !== undefined
            ? () => onOpenCharacter(binding.characterId)
            : undefined
        }
      />
    );
  });
  const locChips = leaf.locations.map((binding) => {
    const involvement = binding.involvement;
    const tag =
      involvement !== undefined
        ? [LEAF_LOC_ROLE_LABEL[involvement.role] ?? involvement.role, involvement.affected ? "受影响" : ""]
            .filter(Boolean)
            .join(" · ")
        : "";
    return (
      <RefChip
        key={binding.locationId}
        icon={MapPin}
        label={lookupName(locationNames, binding.locationId)}
        tag={tag}
        onClick={
          onOpenLocation !== undefined ? () => onOpenLocation(binding.locationId) : undefined
        }
      />
    );
  });
  const row = (key: string, value: ReactNode): ReactNode =>
    value === undefined || value === null ? null : (
      <>
        <dt>{key}</dt>
        <dd>{value}</dd>
      </>
    );
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>场景计划</h3>
      <dl className={styles.paramList}>
        {row(
          "场景模式",
          leaf.settingMode === "located" ? "有确定地点" : "无固定地点",
        )}
        {row("时间", leaf.time?.description || undefined)}
        {row(
          "人物绑定",
          charChips.length > 0 ? <div className={styles.refChips}>{charChips}</div> : undefined,
        )}
        {row(
          "地点绑定",
          locChips.length > 0 ? <div className={styles.refChips}>{locChips}</div> : undefined,
        )}
        {row(
          "事件序列",
          leaf.events.length > 0 ? (
            <div className={styles.leafSeq}>
              {leaf.events.map((event, index) => (
                <span key={event.id}>
                  <i>{String(index + 1).padStart(2, "0")}</i>
                  {event.description}
                </span>
              ))}
            </div>
          ) : undefined,
        )}
        {row(
          "节奏拍",
          leaf.rhythmBeats.length > 0 ? (
            <div className={styles.refChips}>
              {leaf.rhythmBeats.map((beat) => (
                <StatusChip key={beat.id} variant="neutral">
                  {`${LEAF_RHYTHM_LABEL[beat.rhythm] ?? beat.rhythm} · 强度 ${beat.intensity}${beat.readerEmotion ? ` · ${beat.readerEmotion}` : ""}`}
                </StatusChip>
              ))}
            </div>
          ) : undefined,
        )}
        {row(
          "实体变更",
          leaf.entityChanges.length > 0 ? (
            <div className={styles.leafSeq}>
              {leaf.entityChanges.map((change) => (
                <span key={change.id}>
                  <i>{LEAF_CHANGE_LABEL[change.category] ?? change.category}</i>
                  {change.summary}
                </span>
              ))}
            </div>
          ) : undefined,
        )}
      </dl>
    </div>
  );
}
