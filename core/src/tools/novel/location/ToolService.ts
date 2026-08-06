/**
 * Provider-neutral Novel Location tool semantics: read/list profiles, batch
 * create with host-generated ids, and field-level PATCH updates with null
 * clearing. Entity versions stay inside the host boundary.
 */
import { canonicalStringifyJson, type JsonValue } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  LocationQueryService,
  LocationService,
  NovelDraftSessionService,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  canonicalNovelReadScope,
  captureLocationId,
  captureStableEntityProfile,
  draftNovelReadScope,
  type Location,
  type LocationId,
  type NovelDraftSession,
  type NovelReadScope,
} from "../../../novel/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import type {
  LocationProfileWriteValue,
  NovelLocationDetails,
  NovelLocationEditArguments,
  NovelLocationEditValue,
  NovelLocationItemDetails,
  NovelLocationReadArguments,
  NovelLocationReadDetails,
  NovelLocationWriteArguments,
  NovelLocationWriteDetails,
} from "./schemas.js";

export interface NovelLocationToolServiceOptions {
  readonly locations: LocationService;
  readonly locationQueries: LocationQueryService;
  readonly drafts: NovelDraftSessionService;
  readonly identityFactory: { createLocationId(): LocationId };
  readonly logger?: Logger;
}

const ITEM_REJECTION = {
  notFound: "not_found",
  duplicateId: "duplicate_id",
  invalidValue: "invalid_value",
  preconditionFailed: "precondition_failed",
} as const;

export class NovelLocationToolService {
  private readonly logger: Logger;

  constructor(private readonly options: NovelLocationToolServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_location_tool_service",
    });
  }

  async read(
    conversationId: string,
    arguments_: NovelLocationReadArguments,
  ): Promise<NovelLocationReadDetails> {
    const scope = await this.resolveReadScope(conversationId, arguments_.scope);
    if (scope === undefined) {
      return { locations: [] };
    }
    const locations =
      arguments_.locationId === undefined
        ? await this.options.locationQueries.list(scope)
        : [await this.options.locationQueries.get(
            scope,
            captureLocationId(arguments_.locationId),
          )]
            .filter((value): value is Location => value !== undefined);
    return {
      locations: locations.map((location) => toLocationDetails(location)),
    };
  }

  async write(
    conversationId: string,
    arguments_: NovelLocationWriteArguments,
  ): Promise<NovelLocationWriteDetails> {
    const session = await this.resolveOrStartDraft(conversationId);
    const scope = draftNovelReadScope(session);
    const items: NovelLocationItemDetails[] = [];
    this.logger.info("novel_location_tool.write.started", {
      conversationId,
      draftSessionId: session.id,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      const locationId = captureLocationId(
        value.id ?? this.options.identityFactory.createLocationId(),
      );
      try {
        items.push(await this.writeOne(session, scope, value, locationId));
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_LOCATION_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId,
          });
        }
        items.push(rejectedItem(locationId, reason));
        break;
      }
    }
    this.logger.info("novel_location_tool.write.completed", {
      conversationId,
      draftSessionId: session.id,
      appliedCount: items.filter((item) => item.status === "appended").length,
      rejectedCount: items.filter((item) => item.status === "rejected").length,
    });
    return { items };
  }

  async edit(
    conversationId: string,
    arguments_: NovelLocationEditArguments,
  ): Promise<NovelLocationWriteDetails> {
    const session = await this.resolveOrStartDraft(conversationId);
    const scope = draftNovelReadScope(session);
    const items: NovelLocationItemDetails[] = [];
    this.logger.info("novel_location_tool.edit.started", {
      conversationId,
      draftSessionId: session.id,
      requestedCount: arguments_.values.length,
    });
    for (const patch of arguments_.values) {
      try {
        items.push(await this.editOne(session, scope, patch.id, patch.value));
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_LOCATION_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId,
          });
        }
        items.push(rejectedItem(patch.id, reason));
        break;
      }
    }
    this.logger.info("novel_location_tool.edit.completed", {
      conversationId,
      draftSessionId: session.id,
      appliedCount: items.filter((item) => item.status === "appended").length,
      rejectedCount: items.filter((item) => item.status === "rejected").length,
    });
    return { items };
  }

  private async writeOne(
    session: NovelDraftSession,
    scope: NovelReadScope,
    value: LocationProfileWriteValue,
    locationId: LocationId,
  ): Promise<NovelLocationItemDetails> {
    if (
      (await this.options.locationQueries.get(scope, locationId)) !== undefined
    ) {
      throw new NovelLocationItemFailure(ITEM_REJECTION.duplicateId);
    }
    const profile = captureStableEntityProfile({
      name: value.name,
      aliases: value.aliases,
      ...(value.summary === undefined ? {} : { summary: value.summary }),
      ...(value.initialState === undefined
        ? {}
        : { initialState: value.initialState }),
      ...(value.authorNotes === undefined
        ? {}
        : { authorNotes: value.authorNotes }),
    });
    const receipt = await this.options.locations.create(
      session,
      locationId,
      profile,
    );
    return Object.freeze({
      id: locationId,
      status: "appended",
      sequence: receipt.sequence,
    });
  }

  private async editOne(
    session: NovelDraftSession,
    scope: NovelReadScope,
    idInput: string,
    patch: NovelLocationEditValue,
  ): Promise<NovelLocationItemDetails> {
    const id = captureLocationId(idInput);
    const current = await this.options.locationQueries.get(scope, id);
    if (current === undefined) {
      throw new NovelLocationItemFailure(ITEM_REJECTION.notFound);
    }
    const merged = captureStableEntityProfile({
      name: patch.name ?? current.name,
      aliases: patch.aliases ?? current.aliases,
      ...mergeOptional("summary", current.summary, patch.summary),
      ...mergeOptional("initialState", current.initialState, patch.initialState),
      ...mergeOptional("authorNotes", current.authorNotes, patch.authorNotes),
    });
    if (
      canonicalStringifyJson(merged as unknown as JsonValue) ===
      canonicalStringifyJson(profileOf(current) as unknown as JsonValue)
    ) {
      return Object.freeze({ id, status: "duplicate" });
    }
    const receipt = await this.options.locations.replace(
      session,
      id,
      current.entityVersion,
      merged,
    );
    return Object.freeze({
      id,
      status: "appended",
      sequence: receipt.sequence,
    });
  }

  private async resolveOrStartDraft(
    conversationId: string,
  ): Promise<NovelDraftSession> {
    const existing = await this.options.drafts.getActiveDraft(conversationId);
    if (existing !== undefined) return existing;
    try {
      return await this.options.drafts.startDraft(conversationId);
    } catch {
      this.logger.warn("novel_location_tool.draft.start_failed", {
        conversationId,
      });
      throw new ToolError({
        code: "NOVEL_DRAFT_START_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "possible",
        conversationId,
      });
    }
  }

  private async resolveReadScope(
    conversationId: string,
    scope: NovelLocationReadArguments["scope"],
  ): Promise<NovelReadScope | undefined> {
    if (scope === "canonical") return canonicalNovelReadScope;
    const session = await this.options.drafts.getActiveDraft(conversationId);
    return session === undefined ? undefined : draftNovelReadScope(session);
  }
}

class NovelLocationItemFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "NovelLocationItemFailure";
  }
}

function rejectedItem(
  id: string,
  reason: string,
): NovelLocationItemDetails {
  return Object.freeze({ id, status: "rejected", reason });
}

function mapItemError(error: unknown): string | undefined {
  if (error instanceof NovelLocationItemFailure) return error.reason;
  if (error instanceof NovelProtocolValidationError) {
    return ITEM_REJECTION.invalidValue;
  }
  if (error instanceof NovelOperationPreconditionError) {
    return ITEM_REJECTION.preconditionFailed;
  }
  return undefined;
}

function mergeOptional(
  field: "summary" | "initialState" | "authorNotes",
  current: string | undefined,
  patch: string | null | undefined,
): Partial<{ summary: string; initialState: string; authorNotes: string }> {
  if (patch === undefined) {
    return current === undefined ? {} : { [field]: current };
  }
  if (patch === null) return {};
  return { [field]: patch };
}

function profileOf(location: Location): {
  name: string;
  aliases: readonly string[];
  summary?: string;
  initialState?: string;
  authorNotes?: string;
} {
  return {
    name: location.name,
    aliases: location.aliases,
    ...(location.summary === undefined ? {} : { summary: location.summary }),
    ...(location.initialState === undefined
      ? {}
      : { initialState: location.initialState }),
    ...(location.authorNotes === undefined
      ? {}
      : { authorNotes: location.authorNotes }),
  };
}

function toLocationDetails(location: Location): NovelLocationDetails {
  return Object.freeze({
    id: location.id,
    name: location.name,
    aliases: [...location.aliases],
    ...(location.summary === undefined ? {} : { summary: location.summary }),
    ...(location.initialState === undefined
      ? {}
      : { initialState: location.initialState }),
    ...(location.authorNotes === undefined
      ? {}
      : { authorNotes: location.authorNotes }),
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
  });
}
