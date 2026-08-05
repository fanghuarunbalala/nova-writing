/** Process-local application settings state; persistence is supplied later by hosts. */
import {
  captureModelProviderSettingsInput,
  freezeModelProviderSettings,
  type ModelProviderSettings,
  type ModelProviderSettingsInput,
} from "./ModelProviderSettings.js";

export type SidebarMode = "expanded" | "collapsed";

export interface ApplicationSettingsState {
  readonly sidebarMode?: SidebarMode;
  readonly modelProviders?: readonly ModelProviderSettings[];
  readonly activeModelProviderId?: string;
}

export interface ApplicationSettingsSnapshot {
  readonly revision: number;
  readonly sidebarMode: SidebarMode;
  readonly modelProviders: readonly ModelProviderSettings[];
  readonly activeModelProviderId?: string;
}

export type ApplicationSettingsListener = () => void;

export class ApplicationSettingsStore {
  private readonly listeners = new Set<ApplicationSettingsListener>();
  private revision = 0;
  private nextProviderSequence = 1;
  private snapshot: ApplicationSettingsSnapshot;

  constructor(initialState: ApplicationSettingsState = {}) {
    const modelProviders = captureInitialProviders(initialState.modelProviders ?? []);
    const activeModelProviderId = captureActiveProviderId(
      modelProviders,
      initialState.activeModelProviderId,
    );
    this.snapshot = freezeSnapshot({
      revision: 0,
      sidebarMode: initialState.sidebarMode ?? "expanded",
      modelProviders,
      ...(activeModelProviderId === undefined ? {} : { activeModelProviderId }),
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
    this.update({ ...this.snapshot, sidebarMode });
  }

  addModelProvider(input: ModelProviderSettingsInput): ModelProviderSettings {
    const captured = captureModelProviderSettingsInput(input);
    const provider = freezeModelProviderSettings({
      id: this.createProviderId(),
      ...captured,
    });
    this.update({
      ...this.snapshot,
      modelProviders: [...this.snapshot.modelProviders, provider],
      activeModelProviderId: this.snapshot.activeModelProviderId ?? provider.id,
    });
    return provider;
  }

  updateModelProvider(
    providerId: string,
    input: ModelProviderSettingsInput,
  ): ModelProviderSettings {
    const index = this.snapshot.modelProviders.findIndex(
      (provider) => provider.id === providerId,
    );
    if (index < 0) throw new Error("MODEL_PROVIDER_NOT_FOUND");
    const provider = freezeModelProviderSettings({
      id: providerId,
      ...captureModelProviderSettingsInput(input),
    });
    const modelProviders = [...this.snapshot.modelProviders];
    modelProviders[index] = provider;
    this.update({ ...this.snapshot, modelProviders });
    return provider;
  }

  setActiveModelProvider(providerId: string): void {
    if (this.snapshot.activeModelProviderId === providerId) return;
    if (!this.snapshot.modelProviders.some((provider) => provider.id === providerId)) {
      throw new Error("MODEL_PROVIDER_NOT_FOUND");
    }
    this.update({ ...this.snapshot, activeModelProviderId: providerId });
  }

  private createProviderId(): string {
    let candidate: string;
    do {
      candidate = `model-provider-${this.nextProviderSequence}`;
      this.nextProviderSequence += 1;
    } while (this.snapshot.modelProviders.some((provider) => provider.id === candidate));
    return candidate;
  }

  private update(snapshot: Omit<ApplicationSettingsSnapshot, "revision">): void {
    this.revision += 1;
    this.snapshot = freezeSnapshot({ ...snapshot, revision: this.revision });
    for (const listener of [...this.listeners]) listener();
  }
}

function freezeSnapshot(
  snapshot: ApplicationSettingsSnapshot,
): ApplicationSettingsSnapshot {
  return Object.freeze({
    ...snapshot,
    modelProviders: Object.freeze(
      snapshot.modelProviders.map(freezeModelProviderSettings),
    ),
  });
}

function captureInitialProviders(
  providers: readonly ModelProviderSettings[],
): readonly ModelProviderSettings[] {
  const ids = new Set<string>();
  return Object.freeze(
    providers.map((provider) => {
      const id = provider.id.trim();
      if (id.length === 0 || ids.has(id)) throw new Error("MODEL_PROVIDER_ID_INVALID");
      ids.add(id);
      return freezeModelProviderSettings({
        id,
        ...captureModelProviderSettingsInput(provider),
      });
    }),
  );
}

function captureActiveProviderId(
  providers: readonly ModelProviderSettings[],
  activeProviderId: string | undefined,
): string | undefined {
  if (activeProviderId === undefined) return providers[0]?.id;
  if (!providers.some((provider) => provider.id === activeProviderId)) {
    throw new Error("MODEL_PROVIDER_NOT_FOUND");
  }
  return activeProviderId;
}
