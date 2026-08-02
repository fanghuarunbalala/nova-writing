/** Immutable local UI state for application context and sidebar presentation. */
export interface ShellContextIdentity {
  readonly id: string;
  readonly label: string;
}

export interface ShellMetaIdentity extends ShellContextIdentity {
  readonly kind?: string;
}

export type SidebarMode = "expanded" | "collapsed";

export interface ApplicationShellState {
  readonly workspace?: ShellContextIdentity;
  readonly novel?: ShellContextIdentity;
  readonly meta?: ShellMetaIdentity;
  readonly conversation?: ShellContextIdentity;
  readonly agent?: ShellContextIdentity;
  readonly sidebarMode?: SidebarMode;
}

export interface ApplicationShellSnapshot {
  readonly revision: number;
  readonly workspace?: ShellContextIdentity;
  readonly novel?: ShellContextIdentity;
  readonly meta?: ShellMetaIdentity;
  readonly conversation?: ShellContextIdentity;
  readonly agent?: ShellContextIdentity;
  readonly sidebarMode: SidebarMode;
}

export type ApplicationShellListener = () => void;

export class ApplicationShellStore {
  private readonly listeners = new Set<ApplicationShellListener>();
  private revision = 0;
  private state: ApplicationShellState;
  private snapshot: ApplicationShellSnapshot;

  constructor(initialState: ApplicationShellState = {}) {
    this.state = captureState(initialState);
    this.snapshot = buildSnapshot(this.revision, this.state);
  }

  getSnapshot(): ApplicationShellSnapshot {
    return this.snapshot;
  }

  subscribe(listener: ApplicationShellListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replaceContext(state: Omit<ApplicationShellState, "sidebarMode">): void {
    this.update({ ...state, sidebarMode: this.state.sidebarMode });
  }

  setWorkspace(workspace: ShellContextIdentity | undefined): void {
    this.update({ ...this.state, workspace });
  }

  setNovel(novel: ShellContextIdentity | undefined): void {
    this.update({ ...this.state, novel });
  }

  setMeta(meta: ShellMetaIdentity | undefined): void {
    this.update({ ...this.state, meta });
  }

  setConversation(conversation: ShellContextIdentity | undefined): void {
    this.update({ ...this.state, conversation });
  }

  setAgent(agent: ShellContextIdentity | undefined): void {
    this.update({ ...this.state, agent });
  }

  setSidebarMode(sidebarMode: SidebarMode): void {
    this.update({ ...this.state, sidebarMode });
  }

  private update(nextState: ApplicationShellState): void {
    const captured = captureState(nextState);
    if (sameState(this.state, captured)) return;
    this.state = captured;
    this.revision += 1;
    this.snapshot = buildSnapshot(this.revision, captured);
    for (const listener of [...this.listeners]) listener();
  }
}

function captureState(state: ApplicationShellState): ApplicationShellState {
  return Object.freeze({
    ...(state.workspace !== undefined
      ? { workspace: captureIdentity(state.workspace, "Workspace") }
      : {}),
    ...(state.novel !== undefined
      ? { novel: captureIdentity(state.novel, "Novel") }
      : {}),
    ...(state.meta !== undefined
      ? {
          meta: Object.freeze({
            ...captureIdentity(state.meta, "Meta"),
            ...(state.meta.kind !== undefined
              ? { kind: requireNonBlank(state.meta.kind, "Meta kind") }
              : {}),
          }),
        }
      : {}),
    ...(state.conversation !== undefined
      ? { conversation: captureIdentity(state.conversation, "Conversation") }
      : {}),
    ...(state.agent !== undefined
      ? { agent: captureIdentity(state.agent, "Agent") }
      : {}),
    sidebarMode: state.sidebarMode ?? "expanded",
  });
}

function captureIdentity(
  identity: ShellContextIdentity,
  category: string,
): ShellContextIdentity {
  return Object.freeze({
    id: requireNonBlank(identity.id, `${category} id`),
    label: requireNonBlank(identity.label, `${category} label`),
  });
}

function buildSnapshot(
  revision: number,
  state: ApplicationShellState,
): ApplicationShellSnapshot {
  return Object.freeze({
    revision,
    ...state,
    sidebarMode: state.sidebarMode ?? "expanded",
  });
}

function sameState(
  left: ApplicationShellState,
  right: ApplicationShellState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
  return value;
}
