/** Process-local application settings state; persistence is supplied later by hosts. */
import type { SidebarMode } from "../state/index.js";

export interface ApplicationSettingsState {
  readonly sidebarMode?: SidebarMode;
}

export interface ApplicationSettingsSnapshot {
  readonly revision: number;
  readonly sidebarMode: SidebarMode;
}

export type ApplicationSettingsListener = () => void;

export class ApplicationSettingsStore {
  private readonly listeners = new Set<ApplicationSettingsListener>();
  private revision = 0;
  private snapshot: ApplicationSettingsSnapshot;

  constructor(initialState: ApplicationSettingsState = {}) {
    this.snapshot = freezeSnapshot({
      revision: 0,
      sidebarMode: initialState.sidebarMode ?? "expanded",
    });
  }

  getSnapshot(): ApplicationSettingsSnapshot {
    return this.snapshot;
  }

  subscribe(listener: ApplicationSettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSidebarMode(sidebarMode: SidebarMode): void {
    if (this.snapshot.sidebarMode === sidebarMode) return;
    this.revision += 1;
    this.snapshot = freezeSnapshot({ revision: this.revision, sidebarMode });
    for (const listener of [...this.listeners]) listener();
  }
}

function freezeSnapshot(
  snapshot: ApplicationSettingsSnapshot,
): ApplicationSettingsSnapshot {
  return Object.freeze({ ...snapshot });
}
