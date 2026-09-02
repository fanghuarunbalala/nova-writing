/**
 * LocationGrid
 *
 * 地点网格容器 + 新建入口。
 */
import { MapPin, Plus } from "lucide-react";
import type { LocationSummary } from "../store/LocationStore.js";
import { Button, EmptyState, Icon, LoadingState } from "../../../../shared/primitives/index.js";
import { LocationCard } from "./LocationCard.js";
import styles from "./LocationGrid.module.css";

export interface LocationGridProps {
  readonly workspaceId: string;
  readonly locations: readonly LocationSummary[];
  readonly phase?: "idle" | "loading" | "ready" | "error";
  readonly onSelect?: (locationId: string) => void;
  /** 新建地点入口（宿主打开编辑对话框） */
  readonly onNewLocation?: () => void;
}

export function LocationGrid({ workspaceId, locations, phase, onSelect, onNewLocation }: LocationGridProps) {
  return (
    <div data-workspace={workspaceId}>
      {onNewLocation !== undefined ? (
        <div className={styles.toolbar}>
          <Button variant="secondary" size="sm" leadingIcon={<Icon icon={Plus} size="sm" />} onClick={onNewLocation}>
            新建地点
          </Button>
        </div>
      ) : null}
      {phase === "loading" ? (
        <LoadingState label="正在加载地点档案…" />
      ) : locations.length === 0 && (phase === undefined || phase === "ready") ? (
        <EmptyState
          icon={MapPin}
          title="还没有地点"
          description="在对话中提到场景时，Novel Agent 会提议建档；也可以直接新建。"
          action={
            onNewLocation !== undefined ? (
              <Button variant="secondary" size="sm" leadingIcon={<Icon icon={Plus} size="sm" />} onClick={onNewLocation}>
                新建地点
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={styles.grid}>
          {locations.map((location) => (
            <LocationCard
              key={location.locationId}
              location={location}
              onSelect={() => onSelect?.(location.locationId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
