/** Draft-only Location mutation service that constructs deterministic Operations. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  captureNovelDraftSession,
  type NovelDraftSession,
} from "../draft/index.js";
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
  NovelDraftOperationReceipt,
} from "../port/index.js";
import {
  captureNovelEntityVersion,
  type NovelEntityVersion,
} from "../version/index.js";
import type { NovelMutationService } from "./NovelMutationService.js";

export interface LocationServiceOptions {
  readonly mutations: NovelMutationService;
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
    session: NovelDraftSession,
    id: LocationId,
    profile: StableEntityProfile,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const locationId = captureLocationId(id);
    const operation = createLocationCreateOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: locationId,
      profile,
      timestamp: this.options.clock.now(),
    });
    const receipt = await this.options.mutations.execute(draft, operation);
    this.logger.info("novel_location.create.completed", {
      novelId: draft.novelId,
      draftSessionId: draft.id,
      locationId,
      operationId: operation.operationId,
    });
    return receipt;
  }

  async replace(
    session: NovelDraftSession,
    id: LocationId,
    expectedEntityVersion: NovelEntityVersion,
    profile: StableEntityProfile,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const locationId = captureLocationId(id);
    const operation = createLocationReplaceOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: locationId,
      expectedEntityVersion: captureNovelEntityVersion(expectedEntityVersion),
      profile,
      timestamp: this.options.clock.now(),
    });
    const receipt = await this.options.mutations.execute(draft, operation);
    this.logger.info("novel_location.replace.completed", {
      novelId: draft.novelId,
      draftSessionId: draft.id,
      locationId,
      operationId: operation.operationId,
    });
    return receipt;
  }

  async delete(
    session: NovelDraftSession,
    id: LocationId,
    expectedEntityVersion: NovelEntityVersion,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const locationId = captureLocationId(id);
    const operation = createLocationDeleteOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: locationId,
      expectedEntityVersion: captureNovelEntityVersion(expectedEntityVersion),
    });
    const receipt = await this.options.mutations.execute(draft, operation);
    this.logger.info("novel_location.delete.completed", {
      novelId: draft.novelId,
      draftSessionId: draft.id,
      locationId,
      operationId: operation.operationId,
    });
    return receipt;
  }
}
