/** Owns Main-only directory selections and safe per-window Workspace sessions. */
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
  noopLogger,
  type ApiTransport,
  type Logger,
  type WorkspaceStoreLocation,
} from "@novel/core";
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
  readonly applicationFactory?: DesktopWorkspaceApiApplicationFactory;
  readonly logger?: Logger;
}

export interface DesktopWorkspaceApiApplication {
  readonly transport: ApiTransport;
  close(): Promise<void>;
}

export interface DesktopWorkspaceApiApplicationFactory {
  open(
    location: WorkspaceStoreLocation,
  ): Promise<DesktopWorkspaceApiApplication>;
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

export interface DesktopWorkspaceApiTransportResolver {
  resolveTransport(senderId: number): ApiTransport | undefined;
}

interface PendingSelection {
  readonly senderId: number;
  readonly workspaceRoot: string;
  readonly label: string;
}

interface ActiveWorkspace {
  readonly session: ElectronWorkspaceSession;
  readonly application?: DesktopWorkspaceApiApplication;
}

export class DesktopWorkspaceService
  implements DesktopWorkspaceServicePort, DesktopWorkspaceApiTransportResolver
{
  private readonly picker: DesktopWorkspaceDirectoryPicker;
  private readonly locator: DesktopWorkspaceServiceOptions["locator"];
  private readonly applicationFactory?: DesktopWorkspaceApiApplicationFactory;
  private readonly logger: Logger;
  private readonly selections = new Map<string, PendingSelection>();
  private readonly currentBySender = new Map<number, ActiveWorkspace>();
  private readonly recent = new Map<string, ElectronWorkspaceSession>();

  constructor(options: DesktopWorkspaceServiceOptions) {
    this.picker = options.picker;
    this.locator = options.locator;
    this.applicationFactory = options.applicationFactory;
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
    const current = this.currentBySender.get(senderId);
    if (current?.session.id === session.id) return current.session;
    const application = await this.applicationFactory?.open(location);
    try {
      await current?.application?.close();
    } catch {
      await application?.close().catch(() => undefined);
      throw new DesktopWorkspaceApplicationReplaceError();
    }
    this.currentBySender.set(senderId, {
      session,
      ...(application !== undefined ? { application } : {}),
    });
    this.recent.delete(session.id);
    this.recent.set(session.id, session);
    this.logger.info("desktop_workspace.open_completed", { senderId });
    return session;
  }

  async close(senderId: number): Promise<void> {
    const current = this.currentBySender.get(senderId);
    this.currentBySender.delete(senderId);
    await current?.application?.close();
    this.logger.info("desktop_workspace.close_completed", { senderId });
  }

  async releaseSender(senderId: number): Promise<void> {
    const current = this.currentBySender.get(senderId);
    this.currentBySender.delete(senderId);
    for (const [referenceId, selection] of this.selections) {
      if (selection.senderId === senderId) this.selections.delete(referenceId);
    }
    await current?.application?.close();
    this.logger.debug("desktop_workspace.sender_released", { senderId });
  }

  resolveTransport(senderId: number): ApiTransport | undefined {
    return this.currentBySender.get(senderId)?.application?.transport;
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

export class DesktopWorkspaceApplicationReplaceError extends Error {
  readonly code = "DESKTOP_WORKSPACE_APPLICATION_REPLACE_FAILED";
}
