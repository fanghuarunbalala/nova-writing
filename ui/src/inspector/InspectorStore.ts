/** Immutable local Inspector navigation and query-lifecycle state for shared UI. */
export type InspectorSize = "closed" | "normal" | "expanded";

export interface InspectorTarget {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly parameters?: Readonly<Record<string, string>>;
}

export type InspectorContentSnapshot =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "loaded" }
  | { readonly status: "stale" }
  | {
      readonly status: "error";
      readonly code: string;
      readonly retryable: boolean;
    }
  | { readonly status: "unavailable"; readonly code: string };

export interface InspectorStoreInitialState {
  readonly target?: InspectorTarget;
  readonly mode?: Exclude<InspectorSize, "closed">;
  readonly activeTab?: string;
  readonly selectedNodeKey?: string;
}

export interface InspectorSnapshot {
  readonly revision: number;
  readonly mode: InspectorSize;
  readonly target?: InspectorTarget;
  readonly navigation: readonly InspectorTarget[];
  readonly canGoBack: boolean;
  readonly activeTab?: string;
  readonly selectedNodeKey?: string;
  readonly content: InspectorContentSnapshot;
}

export interface OpenInspectorOptions {
  readonly mode?: Exclude<InspectorSize, "closed">;
  readonly replace?: boolean;
}

export type InspectorListener = () => void;

const IDLE_CONTENT = Object.freeze({ status: "idle" }) satisfies InspectorContentSnapshot;

export class InspectorStore {
  private readonly listeners = new Set<InspectorListener>();
  private revision = 0;
  private mode: InspectorSize;
  private navigation: InspectorTarget[];
  private activeTab?: string;
  private selectedNodeKey?: string;
  private content: InspectorContentSnapshot = IDLE_CONTENT;
  private snapshot: InspectorSnapshot;

  constructor(initialState: InspectorStoreInitialState = {}) {
    const target = initialState.target === undefined
      ? undefined
      : captureInspectorTarget(initialState.target);
    this.navigation = target === undefined ? [] : [target];
    this.mode = target === undefined
      ? "closed"
      : requireVisibleInspectorSize(initialState.mode ?? "normal");
    this.activeTab = captureOptionalToken(initialState.activeTab, "Inspector tab");
    this.selectedNodeKey = captureOptionalToken(
      initialState.selectedNodeKey,
      "Inspector selected node key",
    );
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot(): InspectorSnapshot {
    return this.snapshot;
  }

  subscribe(listener: InspectorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  open(target: InspectorTarget, options: OpenInspectorOptions = {}): void {
    const captured = captureInspectorTarget(target);
    const current = this.navigation.at(-1);
    const mode = requireVisibleInspectorSize(
      options.mode ?? (this.mode === "closed" ? "normal" : this.mode),
    );
    if (current?.key === captured.key) {
      if (sameTarget(current, captured) && this.mode === mode) return;
      this.navigation = [...this.navigation.slice(0, -1), captured];
      this.mode = mode;
      this.resetTargetLocalState();
      this.publish();
      return;
    }
    this.navigation = options.replace
      ? [...this.navigation.slice(0, -1), captured]
      : [...this.navigation, captured];
    this.mode = mode;
    this.resetTargetLocalState();
    this.publish();
  }

  openRoot(
    target: InspectorTarget,
    mode: Exclude<InspectorSize, "closed"> = "normal",
  ): void {
    const captured = captureInspectorTarget(target);
    const capturedMode = requireVisibleInspectorSize(mode);
    if (
      this.navigation.length === 1 &&
      sameTarget(this.navigation[0], captured) &&
      this.mode === capturedMode
    ) {
      return;
    }
    this.navigation = [captured];
    this.mode = capturedMode;
    this.resetTargetLocalState();
    this.publish();
  }

  back(): void {
    if (this.navigation.length <= 1) {
      this.close();
      return;
    }
    this.navigation = this.navigation.slice(0, -1);
    this.resetTargetLocalState();
    this.publish();
  }

  close(): void {
    if (this.mode === "closed" && this.navigation.length === 0) return;
    this.mode = "closed";
    this.navigation = [];
    this.resetTargetLocalState();
    this.publish();
  }

  setMode(mode: InspectorSize): void {
    requireInspectorSize(mode);
    if (mode === "closed") {
      this.close();
      return;
    }
    if (this.navigation.length === 0) {
      throw new Error("Inspector cannot open without a target");
    }
    if (this.mode === mode) return;
    this.mode = mode;
    this.publish();
  }

  setActiveTab(activeTab: string | undefined): void {
    const captured = captureOptionalToken(activeTab, "Inspector tab");
    if (captured === this.activeTab) return;
    this.activeTab = captured;
    this.publish();
  }

  setSelectedNodeKey(selectedNodeKey: string | undefined): void {
    const captured = captureOptionalToken(
      selectedNodeKey,
      "Inspector selected node key",
    );
    if (captured === this.selectedNodeKey) return;
    this.selectedNodeKey = captured;
    this.publish();
  }

  markLoading(targetKey: string): boolean {
    return this.setContent(targetKey, Object.freeze({ status: "loading" }));
  }

  markLoaded(targetKey: string): boolean {
    return this.setContent(targetKey, Object.freeze({ status: "loaded" }));
  }

  markStale(targetKey: string): boolean {
    return this.setContent(targetKey, Object.freeze({ status: "stale" }));
  }

  markError(targetKey: string, code: string, retryable = false): boolean {
    return this.setContent(
      targetKey,
      Object.freeze({
        status: "error",
        code: requireNonBlank(code, "Inspector error code"),
        retryable,
      }),
    );
  }

  markUnavailable(targetKey: string, code: string): boolean {
    return this.setContent(
      targetKey,
      Object.freeze({
        status: "unavailable",
        code: requireNonBlank(code, "Inspector unavailable code"),
      }),
    );
  }

  private setContent(
    targetKey: string,
    content: InspectorContentSnapshot,
  ): boolean {
    const current = this.navigation.at(-1);
    if (current === undefined || current.key !== targetKey) return false;
    if (sameContent(this.content, content)) return true;
    this.content = content;
    this.publish();
    return true;
  }

  private resetTargetLocalState(): void {
    this.activeTab = undefined;
    this.selectedNodeKey = undefined;
    this.content = IDLE_CONTENT;
  }

  private publish(): void {
    this.revision += 1;
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }

  private buildSnapshot(): InspectorSnapshot {
    const navigation = Object.freeze([...this.navigation]);
    const target = navigation.at(-1);
    return Object.freeze({
      revision: this.revision,
      mode: this.mode,
      ...(target !== undefined ? { target } : {}),
      navigation,
      canGoBack: navigation.length > 1,
      ...(this.activeTab !== undefined ? { activeTab: this.activeTab } : {}),
      ...(this.selectedNodeKey !== undefined
        ? { selectedNodeKey: this.selectedNodeKey }
        : {}),
      content: this.content,
    });
  }
}

export function captureInspectorTarget(target: InspectorTarget): InspectorTarget {
  const parameters = target.parameters === undefined
    ? undefined
    : Object.freeze(
        Object.fromEntries(
          Object.entries(target.parameters).map(([key, value]) => [
            requireNonBlank(key, "Inspector parameter name"),
            requireNonBlank(value, "Inspector parameter value"),
          ]),
        ),
      );
  return Object.freeze({
    key: requireNonBlank(target.key, "Inspector target key"),
    kind: requireNonBlank(target.kind, "Inspector target kind"),
    title: requireNonBlank(target.title, "Inspector target title"),
    ...(parameters !== undefined ? { parameters } : {}),
  });
}

function captureOptionalToken(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : requireNonBlank(value, label);
}

function sameTarget(left: InspectorTarget, right: InspectorTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameContent(
  left: InspectorContentSnapshot,
  right: InspectorContentSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
  return value;
}

function requireVisibleInspectorSize(
  value: Exclude<InspectorSize, "closed">,
): Exclude<InspectorSize, "closed"> {
  if (value !== "normal" && value !== "expanded") {
    throw new TypeError("Visible Inspector size must be normal or expanded");
  }
  return value;
}

function requireInspectorSize(value: InspectorSize): InspectorSize {
  if (value !== "closed" && value !== "normal" && value !== "expanded") {
    throw new TypeError("Inspector size is invalid");
  }
  return value;
}
