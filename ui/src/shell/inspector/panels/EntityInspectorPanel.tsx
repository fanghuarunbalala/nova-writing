/**
 * EntityInspectorPanel
 *
 * 实体详情面板：角色/地点，经 novel 域 store 懒加载。
 * 写路径：编辑（EntityEditDialog update 模式，乐观锁 baseRevision=detail.version）、
 * 删除（确认后经 store 删除；实体已删时显示占位）。
 */
import { useState } from "react";
import { CharacterDetailPanel } from "../../../domains/novel/character/components/CharacterDetailPanel.js";
import { useCharacterDetail } from "../../../domains/novel/character/hooks/useCharacterDetail.js";
import { LocationDetailPanel } from "../../../domains/novel/location/components/LocationDetailPanel.js";
import { useLocationDetail } from "../../../domains/novel/location/hooks/useLocationDetail.js";
import { EntityEditDialog } from "../../../domains/novel/components/EntityEditDialog.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import { ConfirmDialog } from "../../../shared/primitives/ConfirmDialog.js";
import type { CharacterStore } from "../../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../../domains/novel/location/store/LocationStore.js";
import styles from "./EntityInspectorPanel.module.css";

export interface EntityInspectorPanelProps {
  readonly workspaceId: string | undefined;
  readonly entityType: "character" | "location";
  readonly entityId: string;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  readonly onLocateInContent?: (entityId: string) => void;
}

export function EntityInspectorPanel({
  workspaceId,
  entityType,
  entityId,
  characters,
  locations,
  onLocateInContent,
}: EntityInspectorPanelProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  if (entityType === "character") {
    const charSnapshot = useExternalStore(characters);
    if (
      charSnapshot.phase === "ready" &&
      !charSnapshot.characters.some((c) => c.characterId === entityId)
    ) {
      return <div className={styles.deletedNotice}>该角色已被删除</div>;
    }
    const { detail } = useCharacterDetail(characters, entityId);
    return (
      <>
        <CharacterDetailPanel
          workspaceId={workspaceId ?? ""}
          characterId={entityId}
          detail={detail}
          onLocateInContent={onLocateInContent}
          onEdit={() => setEditOpen(true)}
          onDelete={() => {
            if (detail !== undefined) setDeleteOpen(true);
          }}
        />
        <EntityEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          entityLabel="角色"
          error={characters.getSnapshot().error?.message}
          initial={
            detail !== undefined
              ? {
                  name: detail.name,
                  aliases: detail.role === "角色" ? [] : [detail.role],
                  summary: detail.summary ?? "",
                  initialState: detail.initialState ?? "",
                  authorNotes: detail.profile,
                }
              : undefined
          }
          onSubmit={(input) => characters.updateCharacter(entityId, input, detail!.version)}
        />
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="删除角色"
          description={`确定删除角色「${detail?.name ?? entityId}」？此操作不可撤销。`}
          onConfirm={() => {
            setDeleteOpen(false);
            if (detail !== undefined) void characters.deleteCharacter(entityId, detail.version);
          }}
        />
      </>
    );
  }
  const locSnapshot = useExternalStore(locations);
  if (
    locSnapshot.phase === "ready" &&
    !locSnapshot.locations.some((l) => l.locationId === entityId)
  ) {
    return <div className={styles.deletedNotice}>该地点已被删除</div>;
  }
  const { detail } = useLocationDetail(locations, entityId);
  return (
    <>
      <LocationDetailPanel
        workspaceId={workspaceId ?? ""}
        locationId={entityId}
        detail={detail}
        onLocateInContent={onLocateInContent}
        onEdit={() => setEditOpen(true)}
        onDelete={() => {
          if (detail !== undefined) setDeleteOpen(true);
        }}
      />
      <EntityEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        entityLabel="地点"
        error={locations.getSnapshot().error?.message}
        initial={
          detail !== undefined
            ? {
                name: detail.name,
                aliases: detail.role === "地点" ? [] : [detail.role],
                summary: detail.summary,
                initialState: detail.initialState,
                authorNotes: detail.profile,
              }
            : undefined
        }
        onSubmit={(input) => locations.updateLocation(entityId, input, detail!.version)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除地点"
        description={`确定删除地点「${detail?.name ?? entityId}」？此操作不可撤销。`}
        onConfirm={() => {
          setDeleteOpen(false);
          if (detail !== undefined) void locations.deleteLocation(entityId, detail.version);
        }}
      />
    </>
  );
}
