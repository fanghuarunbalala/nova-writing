/** Canonical Location mutation service that constructs deterministic Operations. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  captureLocationId,
  type LocationId,
  type NovelOperationId,
} from "../identity/index.js";
import type { StableEntityProfile } from "../model/index.js";
import {
  createLocationCreateOperation,
  createLocationDeleteOperation,
  createLocationReplaceOperation,
} from "../operation/index.js";
import type {
  NovelClock,
  NovelCanonicalWritePort,
  NovelCanonicalWriteResult,
} from "../port/index.js";
import {
  captureNovelEntityVersion,
  captureNovelRevision,
  type NovelEntityVersion,
  type NovelRevision,
} from "../version/index.js";
import type { NovelOperation } from "../operation/index.js";

export interface LocationServiceOptions {
  readonly canonicalWrites: NovelCanonicalWritePort;
  readonly identityFactory: {
    createOperationId(): NovelOperationId;
  };
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

export class LocationService {
  private readonly logger: Logger;

  constructor(private readonly options: LocationServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_location_service",
    });
  }

  async create(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    id: LocationId,
    profile: StableEntityProfile,
  ): Promise<NovelCanonicalWriteResult> {
    const locationId = captureLocationId(id);
    const operation = createLocationCreateOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: locationId,
      profile,
      timestamp: this.options.clock.now(),
    });
    return this.execute(conversationId, baseRevision, operation, "create", {
      locationId,
    });
  }

  async replace(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    id: LocationId,
    expectedEntityVersion: NovelEntityVersion,
    profile: StableEntityProfile,
  ): Promise<NovelCanonicalWriteResult> {
    const locationId = captureLocationId(id);
    const operation = createLocationReplaceOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: locationId,
      expectedEntityVersion: captureNovelEntityVersion(expectedEntityVersion),
      profile,
      timestamp: this.options.clock.now(),
    });
    return this.execute(conversationId, baseRevision, operation, "replace", {
      locationId,
    });
  }

  async delete(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    id: LocationId,
    expectedEntityVersion: NovelEntityVersion,
  ): Promise<NovelCanonicalWriteResult> {
    const locationId = captureLocationId(id);
    const operation = createLocationDeleteOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: locationId,
      expectedEntityVersion: captureNovelEntityVersion(expectedEntityVersion),
    });
    return this.execute(conversationId, baseRevision, operation, "delete", {
      locationId,
    });
  }

  private async execute(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    operation: NovelOperation,
    action: string,
    identity: Readonly<Record<string, string>>,
  ): Promise<NovelCanonicalWriteResult> {
    this.logger.debug("novel_location.operation.started", {
      operationId: operation.operationId,
      operationType: operation.type,
      action,
      ...identity,
    });
    const result = await this.options.canonicalWrites.applyOperations({
      operations: [operation],
      conversationId,
      ...(baseRevision === undefined
        ? {}
        : { baseRevision: captureNovelRevision(baseRevision) }),
    });
    this.logger.info("novel_location.operation.completed", {
      operationId: operation.operationId,
      operationType: operation.type,
      action,
      resultRevision: result.resultRevision,
      status: result.status,
      ...identity,
    });
    return result;
  }
}
