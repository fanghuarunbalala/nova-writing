/**
 * LocationGrid
 *
 * 地点网格容器。
 */
import type { LocationSummary } from "../store/LocationStore.js";
import { LocationCard } from "./LocationCard.js";
import styles from "./LocationGrid.module.css";

export interface LocationGridProps {
  readonly workspaceId: string;
  readonly locations: readonly LocationSummary[];
  readonly onSelect?: (locationId: string) => void;
}

export function LocationGrid({ workspaceId, locations, onSelect }: LocationGridProps) {
  return (
    <div className={styles.grid} data-workspace={workspaceId}>
      {locations.map((location) => (
        <LocationCard
          key={location.locationId}
          location={location}
          onSelect={() => onSelect?.(location.locationId)}
        />
      ))}
    </div>
  );
}
