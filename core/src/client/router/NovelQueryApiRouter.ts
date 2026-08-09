/** Routes read-only Novel client operations to explicit-scope domain query services. */
import type {
  CharacterQueryService,
  LocationQueryService,
  NovelCanonicalMetadata,
  NovelDraftSession,
  NovelReadScope,
  ParagraphQueryService,
  PublicationQueryService,
  StoryOutlineQueryService,
} from "../../novel/index.js";
import {
  canonicalNovelReadScope,
  draftNovelReadScope,
} from "../../novel/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  API_PROTOCOL_VERSION,
  ApiTransportError,
  type ApiErrorSnapshot,
  type ApiRequest,
  type ApiRequestOptions,
  type ApiResponse,
  type ApiSubscription,
  type ApiSubscriptionOptions,
  type ApiTransport,
} from "../../transport/index.js";
import {
  NOVEL_QUERY_API_OPERATION,
  NOVEL_QUERY_SCOPE_KIND,
  captureNovelCharacterQueryRequest,
  captureNovelLocationQueryRequest,
  captureNovelParagraphQueryRequest,
  captureNovelScopedQueryRequest,
  captureNovelStoryUnitQueryRequest,
  type NovelQueryApiOperation,
  type NovelQueryScope,
} from "../novel/NovelQueryApiOperations.js";
import {
  NOVEL_QUERY_SNAPSHOT_VERSION,
  captureNovelCharacterSnapshot,
  captureNovelCharactersSnapshot,
  captureNovelLocationSnapshot,
  captureNovelLocationsSnapshot,
  captureNovelOutlineSnapshot,
  captureNovelOverviewSnapshot,
  captureNovelParagraphCatalogSnapshot,
  captureNovelParagraphSnapshot,
  captureNovelPublicationCatalogSnapshot,
  captureNovelStoryUnitSnapshot,
} from "../novel/NovelQuerySnapshots.js";

export interface NovelQueryMetadataReader {
  getMetadata(): Promise<NovelCanonicalMetadata>;
}

export interface NovelQueryDraftReader {
  getActiveDraft(
    ownerConversationId: string,
  ): Promise<NovelDraftSession | undefined>;
}

export interface NovelQueryApiRouterOptions {
  readonly workspaceId: string;
  readonly novelId: NovelCanonicalMetadata["novelId"];
  readonly metadata: NovelQueryMetadataReader;
  readonly drafts: NovelQueryDraftReader;
  readonly characters: CharacterQueryService;
  readonly locations: LocationQueryService;
  readonly outline: StoryOutlineQueryService;
  readonly publication: PublicationQueryService;
  readonly paragraphs: ParagraphQueryService;
  readonly logger?: Logger;
}

export class NovelQueryApiRouter implements ApiTransport {
  private readonly logger: Logger;

  constructor(private readonly options: NovelQueryApiRouterOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_query_api_router",
      workspaceId: options.workspaceId,
      novelId: options.novelId,
    });
  }

  async request<TData = unknown>(
    request: ApiRequest,
    options: ApiRequestOptions = {},
  ): Promise<ApiResponse<TData>> {
    throwIfAborted(options.signal);
    const requestId = captureRequestId(request);
    let operation = "invalid";
    try {
      operation = validateRequestEnvelope(request);
      if (!isNovelQueryApiOperation(operation)) throw invalidRequest();
      this.logger.debug("novel_query_api.request_started", {
        requestId,
        operation,
      });
      const data = await this.dispatch(operation, request.payload);
      throwIfAborted(options.signal);
      this.logger.debug("novel_query_api.request_completed", {
        requestId,
        operation,
      });
      return Object.freeze({
        protocolVersion: API_PROTOCOL_VERSION,
        requestId,
        ok: true,
        data,
      }) as ApiResponse<TData>;
    } catch (error) {
      if (error instanceof ApiTransportError) throw error;
      const snapshot = createApiErrorSnapshot(error);
      this.logger.info("novel_query_api.request_rejected", {
        requestId,
        operation,
        errorCode: snapshot.code,
        errorCategory: snapshot.category,
        retryable: snapshot.retryable,
      });
      return Object.freeze({
        protocolVersion: API_PROTOCOL_VERSION,
        requestId,
        ok: false,
        error: snapshot,
      });
    }
  }

  subscribe(
    _request: ApiRequest,
    _options: ApiSubscriptionOptions = {},
  ): ApiSubscription {
    throw new ApiTransportError(
      "API_OPERATION_NOT_SUBSCRIBABLE",
      false,
      "Novel query operations do not create subscriptions",
    );
  }

  private async dispatch(
    operation: NovelQueryApiOperation,
    payload: unknown,
  ): Promise<unknown> {
    switch (operation) {
      case NOVEL_QUERY_API_OPERATION.overviewGet:
        return this.getOverview(payload);
      case NOVEL_QUERY_API_OPERATION.outlineGet:
        return this.getOutline(payload);
      case NOVEL_QUERY_API_OPERATION.outlineStoryUnitGet:
        return this.getStoryUnit(payload);
      case NOVEL_QUERY_API_OPERATION.charactersList:
        return this.listCharacters(payload);
      case NOVEL_QUERY_API_OPERATION.characterGet:
        return this.getCharacter(payload);
      case NOVEL_QUERY_API_OPERATION.locationsList:
        return this.listLocations(payload);
      case NOVEL_QUERY_API_OPERATION.locationGet:
        return this.getLocation(payload);
      case NOVEL_QUERY_API_OPERATION.paragraphCatalogGet:
        return this.getParagraphCatalog(payload);
      case NOVEL_QUERY_API_OPERATION.paragraphGet:
        return this.getParagraph(payload);
      case NOVEL_QUERY_API_OPERATION.publicationCatalogGet:
        return this.getPublicationCatalog(payload);
    }
  }

  private async getOverview(payload: unknown) {
    const request = captureNovelScopedQueryRequest(payload);
    const resolved = await this.resolveScope(request.scope);
    const [metadata, tree, characters, locations, publication, paragraphs] =
      await Promise.all([
        this.options.metadata.getMetadata(),
        this.options.outline.getTree(resolved.domain),
        this.options.characters.list(resolved.domain),
        this.options.locations.list(resolved.domain),
        this.options.publication.getCatalog(resolved.domain),
        this.options.paragraphs.getCatalog(resolved.domain),
      ]);
    assertMetadataIdentity(metadata, this.options.workspaceId, this.options.novelId);
    return captureNovelOverviewSnapshot({
      schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
      scope: resolved.client,
      workspaceId: this.options.workspaceId,
      novelId: this.options.novelId,
      novelSchemaVersion: metadata.schemaVersion,
      sourceRevision: resolved.sourceRevision ?? metadata.currentRevision,
      counts: {
        storyUnitCount: tree?.listDepthFirst().length ?? 0,
        characterCount: characters.length,
        locationCount: locations.length,
        volumeCount: publication?.snapshot.volumes.length ?? 0,
        chapterCount: publication?.snapshot.chapters.length ?? 0,
        paragraphCount: paragraphs?.snapshot.paragraphs.length ?? 0,
      },
      roots: {
        outlineAvailable: tree !== undefined,
        publicationAvailable: publication !== undefined,
        paragraphsAvailable: paragraphs !== undefined,
      },
    });
  }

  private async getOutline(payload: unknown) {
    const request = captureNovelScopedQueryRequest(payload);
    const resolved = await this.resolveScope(request.scope);
    const tree = await this.options.outline.getTree(resolved.domain);
    return captureNovelOutlineSnapshot({
      schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
      scope: resolved.client,
      ...(tree === undefined ? {} : { tree: tree.getSnapshot() }),
      progress: tree === undefined
        ? []
        : tree.listDepthFirst().map((unit) => tree.getProgress(unit.id)),
    });
  }

  private async getStoryUnit(payload: unknown) {
    const request = captureNovelStoryUnitQueryRequest(payload);
    const resolved = await this.resolveScope(request.scope);
    const tree = await this.options.outline.getTree(resolved.domain);
    const unit = tree?.getUnit(request.storyUnitId);
    const progress = tree?.getProgress(request.storyUnitId);
    return captureNovelStoryUnitSnapshot({
      schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
      scope: resolved.client,
      ...(unit === undefined ? {} : { unit, progress }),
    });
  }

  private async listCharacters(payload: unknown) {
    const request = captureNovelScopedQueryRequest(payload);
    const resolved = await this.resolveScope(request.scope);
    return captureNovelCharactersSnapshot({
      schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
      scope: resolved.client,
      characters: await this.options.characters.list(resolved.domain),
    });
  }

  private async getCharacter(payload: unknown) {
    const request = captureNovelCharacterQueryRequest(payload);
    const resolved = await this.resolveScope(request.scope);
    const character = await this.options.characters.get(
      resolved.domain,
      request.characterId,
    );
    return captureNovelCharacterSnapshot({
      schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
      scope: resolved.client,
      ...(character === undefined ? {} : { character }),
    });
  }

  private async listLocations(payload: unknown) {
    const request = captureNovelScopedQueryRequest(payload);
    const resolved = await this.resolveScope(request.scope);
    return captureNovelLocationsSnapshot({
      schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
      scope: resolved.client,
      locations: await this.options.locations.list(resolved.domain),
    });
  }

  private async getLocation(payload: unknown) {
    const request = captureNovelLocationQueryRequest(payload);
    const resolved = await this.resolveScope(request.scope);
    const location = await this.options.locations.get(
      resolved.domain,
      request.locationId,
    );
    return captureNovelLocationSnapshot({
      schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
      scope: resolved.client,
      ...(location === undefined ? {} : { location }),
    });
  }

  private async getParagraphCatalog(payload: unknown) {
    const request = captureNovelScopedQueryRequest(payload);
    const resolved = await this.resolveScope(request.scope);
    const catalog = await this.options.paragraphs.getCatalog(resolved.domain);
    return captureNovelParagraphCatalogSnapshot({
      schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
      scope: resolved.client,
      paragraphs: (catalog?.snapshot.paragraphs ?? []).map((paragraph) => ({
        id: paragraph.id,
        storyUnitId: paragraph.storyUnitId,
        orderKey: paragraph.orderKey,
        textLength: paragraph.text.length,
        textDigest: requireParagraphDigest(
          catalog?.paragraphDigests ?? {},
          paragraph.id,
        ),
      })),
    });
  }

  private async getParagraph(payload: unknown) {
    const request = captureNovelParagraphQueryRequest(payload);
    const resolved = await this.resolveScope(request.scope);
    const readModel = await this.options.paragraphs.getParagraph(
      resolved.domain,
      request.paragraphId,
    );
    return captureNovelParagraphSnapshot({
      schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
      scope: resolved.client,
      ...(readModel === undefined ? {} : { readModel }),
    });
  }

  private async getPublicationCatalog(payload: unknown) {
    const request = captureNovelScopedQueryRequest(payload);
    const resolved = await this.resolveScope(request.scope);
    const catalog = await this.options.publication.getCatalog(resolved.domain);
    return captureNovelPublicationCatalogSnapshot({
      schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
      scope: resolved.client,
      volumes: catalog?.snapshot.volumes ?? [],
      chapters: catalog?.snapshot.chapters ?? [],
    });
  }

  private async resolveScope(scope: NovelQueryScope): Promise<{
    readonly client: NovelQueryScope;
    readonly domain: NovelReadScope;
    readonly sourceRevision?: NovelCanonicalMetadata["currentRevision"];
  }> {
    if (scope.kind === NOVEL_QUERY_SCOPE_KIND.canonical) {
      return Object.freeze({ client: scope, domain: canonicalNovelReadScope });
    }
    const session = await this.options.drafts.getActiveDraft(scope.conversationId);
    if (session === undefined) {
      throw new NovelQueryDraftUnavailableError();
    }
    if (
      session.novelId !== this.options.novelId ||
      session.ownerConversationId !== scope.conversationId
    ) {
      throw new NovelQueryIntegrityError();
    }
    return Object.freeze({
      client: scope,
      domain: draftNovelReadScope(session),
      sourceRevision: session.baseRevision,
    });
  }
}

export function isNovelQueryApiOperation(
  operation: string,
): operation is NovelQueryApiOperation {
  return (Object.values(NOVEL_QUERY_API_OPERATION) as readonly string[]).includes(
    operation,
  );
}

class NovelQueryDraftUnavailableError extends Error {}
class NovelQueryIntegrityError extends Error {}

function validateRequestEnvelope(request: ApiRequest): string {
  if (
    request === null ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).sort().join("|") !==
      "operation|payload|protocolVersion|requestId"
  ) {
    throw invalidRequest();
  }
  if (request.protocolVersion !== API_PROTOCOL_VERSION) throw invalidRequest();
  captureRequestId(request);
  if (typeof request.operation !== "string" || request.operation.length === 0) {
    throw invalidRequest();
  }
  return request.operation;
}

function captureRequestId(request: ApiRequest): string {
  if (
    request === null ||
    typeof request !== "object" ||
    typeof request.requestId !== "string" ||
    request.requestId.trim().length === 0
  ) {
    throw new ApiTransportError(
      "INVALID_API_REQUEST",
      false,
      "API request identity is invalid",
    );
  }
  return request.requestId;
}

function assertMetadataIdentity(
  metadata: NovelCanonicalMetadata,
  workspaceId: string,
  novelId: NovelCanonicalMetadata["novelId"],
): void {
  if (metadata.workspaceId !== workspaceId || metadata.novelId !== novelId) {
    throw new NovelQueryIntegrityError();
  }
}

function requireParagraphDigest(
  digests: Readonly<Record<string, Readonly<{ textDigest: string }>>>,
  paragraphId: string,
): string {
  const digest = digests[paragraphId]?.textDigest;
  if (digest === undefined) throw new NovelQueryIntegrityError();
  return digest;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw new ApiTransportError(
    "API_REQUEST_ABORTED",
    true,
    "API request was aborted",
  );
}

function createApiErrorSnapshot(error: unknown): ApiErrorSnapshot {
  if (error instanceof NovelQueryDraftUnavailableError) {
    return freezeError(
      "NOVEL_DRAFT_NOT_FOUND",
      "not-found",
      false,
      "Conversation Draft was not found",
    );
  }
  if (error instanceof NovelQueryIntegrityError) {
    return freezeError(
      "NOVEL_QUERY_INTEGRITY_ERROR",
      "internal",
      false,
      "Novel query state is inconsistent",
    );
  }
  if (error instanceof TypeError) {
    return freezeError(
      "INVALID_API_REQUEST",
      "validation",
      false,
      "Novel query request is invalid",
    );
  }
  return freezeError(
    "INTERNAL_ERROR",
    "internal",
    false,
    "An internal Novel query error occurred",
  );
}

function freezeError(
  code: string,
  category: ApiErrorSnapshot["category"],
  retryable: boolean,
  message: string,
): ApiErrorSnapshot {
  return Object.freeze({ code, category, retryable, message });
}

function invalidRequest(): TypeError {
  return new TypeError("Novel query API request is invalid");
}
