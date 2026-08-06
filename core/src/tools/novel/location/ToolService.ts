/**
 * Provider-neutral Novel Location tool semantics: read/list profiles, batch
 * create with host-generated ids, and field-level PATCH updates with null
 * clearing. Entity versions stay inside the host boundary.
 */
import { canonicalStringifyJson, type JsonValue } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  LocationQueryService,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  SystemNovelClock,
  canonicalNovelReadScope,
  captureLocationId,
  captureNovelRevision,
  captureStableEntityProfile,
  createLocationCreateOperation,
  createLocationReplaceOperation,
  type Location,
  type LocationId,
  type NovelCanonicalWritePort,
  type NovelClock,
  type NovelOperation,
  type NovelOperationId,
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
  readonly locationQueries: LocationQueryService;
  readonly canonicalWrites: NovelCanonicalWritePort;
  readonly identityFactory: {
    createLocationId(): LocationId;
    createOperationId(): NovelOperationId;
  };
  readonly clock?: NovelClock;
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
  private readonly clock: NovelClock;

  constructor(private readonly options: NovelLocationToolServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_location_tool_service",
    });
    this.clock = options.clock ?? new SystemNovelClock();
  }

  async read(
    conversationId: string,
    arguments_: NovelLocationReadArguments,
  ): Promise<NovelLocationReadDetails> {
    const scope = canonicalNovelReadScope;
    const revision = await this.options.canonicalWrites.getCurrentRevision();
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
      revision: { currentRevision: revision },
    };
  }

  async write(
    conversationId: string,
    arguments_: NovelLocationWriteArguments,
  ): Promise<NovelLocationWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const existing = await this.options.locationQueries.list(scope);
    const operations: NovelOperation[] = [];
    const items: NovelLocationItemDetails[] = [];
    this.logger.info("novel_location_tool.write.started", {
      conversationId,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      const locationId = captureLocationId(
        value.id ?? this.options.identityFactory.createLocationId(),
      );
      try {
        this.appendWriteOperation({
          existing,
          value,
          locationId,
          operations,
        });
        items.push({ id: locationId, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_LOCATION_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        this.logger.info("novel_location_tool.write.rejected_batch", {
          conversationId,
          reason,
        });
        return {
          items: [{ id: locationId, status: "rejected", reason }],
          revision: { currentRevision },
        };
      }
    }
    if (operations.length === 0) {
      return { items, revision: { currentRevision } };
    }
    try {
      const result = await this.options.canonicalWrites.applyOperations({
        operations,
        conversationId,
        ...(baseRevision === undefined ? {} : { baseRevision }),
      });
      this.logger.info("novel_location_tool.write.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_location_tool.write.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_LOCATION_WRITE_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  async edit(
    conversationId: string,
    arguments_: NovelLocationEditArguments,
  ): Promise<NovelLocationWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const existing = await this.options.locationQueries.list(scope);
    const existingById = new Map(
      existing.map((location) => [location.id, location]),
    );
    const operations: NovelOperation[] = [];
    const items: NovelLocationItemDetails[] = [];
    this.logger.info("novel_location_tool.edit.started", {
      conversationId,
      requestedCount: arguments_.values.length,
    });
    for (const patch of arguments_.values) {
      try {
        this.appendEditOperation({
          existingById,
          id: patch.id,
          patch: patch.value,
          operations,
        });
        items.push({ id: patch.id, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_LOCATION_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        this.logger.info("novel_location_tool.edit.rejected_batch", {
          conversationId,
          reason,
        });
        return {
          items: [{ id: patch.id, status: "rejected", reason }],
          revision: { currentRevision },
        };
      }
    }
    if (operations.length === 0) {
      return { items, revision: { currentRevision } };
    }
    try {
      const result = await this.options.canonicalWrites.applyOperations({
        operations,
        conversationId,
        ...(baseRevision === undefined ? {} : { baseRevision }),
      });
      this.logger.info("novel_location_tool.edit.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_location_tool.edit.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_LOCATION_EDIT_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  private appendWriteOperation(input: {
    readonly existing: readonly Location[];
    readonly value: LocationProfileWriteValue;
    readonly locationId: LocationId;
    readonly operations: NovelOperation[];
  }): void {
    const { existing, value, locationId, operations } = input;
    if (existing.some((location) => location.id === locationId)) {
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
    operations.push(
      createLocationCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: locationId,
        profile,
        timestamp: this.clock.now(),
      }),
    );
  }

  private appendEditOperation(input: {
    readonly existingById: ReadonlyMap<string, Location>;
    readonly id: string;
    readonly patch: NovelLocationEditValue;
    readonly operations: NovelOperation[];
  }): void {
    const id = captureLocationId(input.id);
    const current = input.existingById.get(id);
    if (current === undefined) {
      throw new NovelLocationItemFailure(ITEM_REJECTION.notFound);
    }
    const merged = captureStableEntityProfile({
      name: input.patch.name ?? current.name,
      aliases: input.patch.aliases ?? current.aliases,
      ...mergeOptional("summary", current.summary, input.patch.summary),
      ...mergeOptional(
        "initialState",
        current.initialState,
        input.patch.initialState,
      ),
      ...mergeOptional("authorNotes", current.authorNotes, input.patch.authorNotes),
    });
    if (
      canonicalStringifyJson(merged as unknown as JsonValue) ===
      canonicalStringifyJson(profileOf(current) as unknown as JsonValue)
    ) {
      return;
    }
    input.operations.push(
      createLocationReplaceOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id,
        expectedEntityVersion: current.entityVersion,
        profile: merged,
        timestamp: this.clock.now(),
      }),
    );
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
