/** Owns Main-only directory selections and safe per-window Workspace sessions. */
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { noopLogger, type Logger } from "@novel/core";
import type { NodeWorkspaceStoreLocator } from "@novel/core/node";
import type {
  ElectronWorkspaceReference,
  ElectronWorkspaceSession,
} from "../../shared/index.js";

export interface DesktopWorkspaceDirectoryPicker {
  pickDirectory(): Promise<string | undefined>;
}

export interface DesktopWorkspaceServiceOptions {
  readonly picker: DesktopWorkspaceDirectoryPicker;
  readonly locator: Pick<
    NodeWorkspaceStoreLocator,
    "resolve" | "getByWorkspaceId"
  >;
  readonly logger?: Logger;
}

export interface DesktopWorkspaceServicePort {
  select(senderId: number): Promise<ElectronWorkspaceReference | undefined>;
  listRecent(senderId: number): Promise<readonly ElectronWorkspaceSession[]>;
  open(
    senderId: number,
    reference: ElectronWorkspaceReference,
  ): Promise<ElectronWorkspaceSession>;
  close(senderId: number): Promise<void>;
  releaseSender(senderId: number): Promise<void>;
}

interface PendingSelection {
  readonly senderId: number;
  readonly workspaceRoot: string;
  readonly label: string;
}

export class DesktopWorkspaceService implements DesktopWorkspaceServicePort {
  private readonly picker: DesktopWorkspaceDirectoryPicker;
  private readonly locator: DesktopWorkspaceServiceOptions["locator"];
  private readonly logger: Logger;
  private readonly selections = new Map<string, PendingSelection>();
  private readonly currentBySender = new Map<number, ElectronWorkspaceSession>();
  private readonly recent = new Map<string, ElectronWorkspaceSession>();

  constructor(options: DesktopWorkspaceServiceOptions) {
    this.picker = options.picker;
    this.locator = options.locator;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_workspace_service",
    });
  }

  async select(senderId: number): Promise<ElectronWorkspaceReference | undefined> {
    this.logger.info("desktop_workspace.selection_started", { senderId });
    const workspaceRoot = await this.picker.pickDirectory();
    if (workspaceRoot === undefined) {
      this.logger.debug("desktop_workspace.selection_cancelled", { senderId });
      return undefined;
    }
    const referenceId = `workspace-selection-${randomUUID()}`;
    const label = basename(workspaceRoot) || "Workspace";
    this.selections.set(referenceId, { senderId, workspaceRoot, label });
    this.logger.info("desktop_workspace.selection_completed", { senderId });
    return Object.freeze({ referenceId, label });
  }

  listRecent(_senderId: number): Promise<readonly ElectronWorkspaceSession[]> {
    return Promise.resolve(
      Object.freeze([...this.recent.values()].map((workspace) => ({ ...workspace }))),
    );
  }

  async open(
    senderId: number,
    reference: ElectronWorkspaceReference,
  ): Promise<ElectronWorkspaceSession> {
    this.logger.info("desktop_workspace.open_started", { senderId });
    const pending = this.selections.get(reference.referenceId);
    const location =
      pending !== undefined
        ? await this.resolvePending(senderId, reference.referenceId, pending)
        : await this.locator.getByWorkspaceId(reference.referenceId);
    if (location === undefined) throw new DesktopWorkspaceNotFoundError();
    const session = Object.freeze({
      id: location.workspaceId,
      label: basename(location.workspaceRoot) || reference.label,
    });
    this.currentBySender.set(senderId, session);
    this.recent.delete(session.id);
    this.recent.set(session.id, session);
    this.logger.info("desktop_workspace.open_completed", { senderId });
    return session;
  }

  close(senderId: number): Promise<void> {
    this.currentBySender.delete(senderId);
    this.logger.info("desktop_workspace.close_completed", { senderId });
    return Promise.resolve();
  }

  releaseSender(senderId: number): Promise<void> {
    this.currentBySender.delete(senderId);
    for (const [referenceId, selection] of this.selections) {
      if (selection.senderId === senderId) this.selections.delete(referenceId);
    }
    this.logger.debug("desktop_workspace.sender_released", { senderId });
    return Promise.resolve();
  }

  private async resolvePending(
    senderId: number,
    referenceId: string,
    selection: PendingSelection,
  ) {
    if (selection.senderId !== senderId) throw new DesktopWorkspaceUnauthorizedError();
    this.selections.delete(referenceId);
    return this.locator.resolve(selection.workspaceRoot);
  }
}

export class DesktopWorkspaceNotFoundError extends Error {
  readonly code = "DESKTOP_WORKSPACE_NOT_FOUND";
}

export class DesktopWorkspaceUnauthorizedError extends Error {
  readonly code = "DESKTOP_WORKSPACE_UNAUTHORIZED";
}
