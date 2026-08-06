/**
 * EntityInspectorPanel
 *
 * 实体详情面板：角色/地点，经 novel 域 store 懒加载。
 */
import { CharacterDetailPanel } from "../../../domains/novel/character/components/CharacterDetailPanel.js";
import { useCharacterDetail } from "../../../domains/novel/character/hooks/useCharacterDetail.js";
import { LocationDetailPanel } from "../../../domains/novel/location/components/LocationDetailPanel.js";
import { useLocationDetail } from "../../../domains/novel/location/hooks/useLocationDetail.js";
import type { CharacterStore } from "../../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../../domains/novel/location/store/LocationStore.js";

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
  if (entityType === "character") {
    const { detail } = useCharacterDetail(characters, entityId);
    return (
      <CharacterDetailPanel
        workspaceId={workspaceId ?? ""}
        characterId={entityId}
        detail={detail}
        onLocateInContent={onLocateInContent}
      />
    );
  }
  const { detail } = useLocationDetail(locations, entityId);
  return (
    <LocationDetailPanel
      workspaceId={workspaceId ?? ""}
      locationId={entityId}
      detail={detail}
      onLocateInContent={onLocateInContent}
    />
  );
}
