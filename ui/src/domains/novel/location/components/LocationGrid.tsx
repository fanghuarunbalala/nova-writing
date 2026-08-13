/**
 * LocationGrid
 *
 * 地点网格容器 + 新建入口。
 */
import type { LocationSummary } from "../store/LocationStore.js";
import { Button } from "../../../../shared/primitives/index.js";
import { LocationCard } from "./LocationCard.js";
import styles from "./LocationGrid.module.css";

export interface LocationGridProps {
  readonly workspaceId: string;
  readonly locations: readonly LocationSummary[];
  readonly onSelect?: (locationId: string) => void;
  /** 新建地点入口（宿主打开编辑对话框） */
  readonly onNewLocation?: () => void;
}

export function LocationGrid({ workspaceId, locations, onSelect, onNewLocation }: LocationGridProps) {
  return (
    <div data-workspace={workspaceId}>
      {onNewLocation !== undefined ? (
        <div className={styles.toolbar}>
          <Button variant="secondary" size="sm" onClick={onNewLocation}>
            ＋ 新建地点
          </Button>
        </div>
      ) : null}
      <div className={styles.grid}>
        {locations.map((location) => (
          <LocationCard
            key={location.locationId}
            location={location}
            onSelect={() => onSelect?.(location.locationId)}
          />
        ))}
      </div>
    </div>
  );
}
