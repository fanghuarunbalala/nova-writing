/** Maps typed Novel queries to strict JSON-safe API frames and response snapshots. */
import { isJsonValue } from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  API_PROTOCOL_VERSION,
  ApiRemoteError,
  isApiErrorCategory,
  type ApiErrorSnapshot,
  type ApiRequest,
  type ApiResponse,
  type ApiTransport,
} from "../../transport/index.js";
import type { ApiRequestIdFactory } from "../../conversation/index.js";
import {
  NOVEL_QUERY_API_OPERATION,
  captureNovelCharacterQueryRequest,
  captureNovelLocationQueryRequest,
  captureNovelParagraphQueryRequest,
  captureNovelScopedQueryRequest,
  captureNovelStoryUnitQueryRequest,
  type NovelQueryScope,
} from "./NovelQueryApiOperations.js";
import {
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
  type NovelCharacterSnapshot,
  type NovelCharactersSnapshot,
  type NovelLocationSnapshot,
  type NovelLocationsSnapshot,
  type NovelOutlineSnapshot,
  type NovelOverviewSnapshot,
  type NovelParagraphCatalogSnapshot,
  type NovelParagraphSnapshot,
  type NovelPublicationCatalogSnapshot,
  type NovelStoryUnitSnapshot,
} from "./NovelQuerySnapshots.js";
import type {
  CharacterId,
  LocationId,
  ParagraphId,
  StoryUnitId,
} from "../../novel/index.js";

export interface NovelQueryClientOptions {
  readonly transport: ApiTransport;
  readonly requestIdFactory: ApiRequestIdFactory;
  readonly logger?: Logger;
}

export class NovelQueryClient {
  private readonly logger: Logger;

  constructor(private readonly options: NovelQueryClientOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_query_client",
    });
  }

  async getOverview(scope: NovelQueryScope): Promise<NovelOverviewSnapshot> {
    const request = captureNovelScopedQueryRequest({ scope });
    return captureNovelOverviewSnapshot(
      await this.request(NOVEL_QUERY_API_OPERATION.overviewGet, request),
    );
  }

  async getOutline(scope: NovelQueryScope): Promise<NovelOutlineSnapshot> {
    const request = captureNovelScopedQueryRequest({ scope });
    return captureNovelOutlineSnapshot(
      await this.request(NOVEL_QUERY_API_OPERATION.outlineGet, request),
    );
  }

  async getStoryUnit(
    scope: NovelQueryScope,
    storyUnitId: StoryUnitId,
  ): Promise<NovelStoryUnitSnapshot> {
    const request = captureNovelStoryUnitQueryRequest({ scope, storyUnitId });
    return captureNovelStoryUnitSnapshot(
      await this.request(NOVEL_QUERY_API_OPERATION.outlineStoryUnitGet, request),
    );
  }

  async listCharacters(scope: NovelQueryScope): Promise<NovelCharactersSnapshot> {
    const request = captureNovelScopedQueryRequest({ scope });
    return captureNovelCharactersSnapshot(
      await this.request(NOVEL_QUERY_API_OPERATION.charactersList, request),
    );
  }

  async getCharacter(
    scope: NovelQueryScope,
    characterId: CharacterId,
  ): Promise<NovelCharacterSnapshot> {
    const request = captureNovelCharacterQueryRequest({ scope, characterId });
    return captureNovelCharacterSnapshot(
      await this.request(NOVEL_QUERY_API_OPERATION.characterGet, request),
    );
  }

  async listLocations(scope: NovelQueryScope): Promise<NovelLocationsSnapshot> {
    const request = captureNovelScopedQueryRequest({ scope });
    return captureNovelLocationsSnapshot(
      await this.request(NOVEL_QUERY_API_OPERATION.locationsList, request),
    );
  }

  async getLocation(
    scope: NovelQueryScope,
    locationId: LocationId,
  ): Promise<NovelLocationSnapshot> {
    const request = captureNovelLocationQueryRequest({ scope, locationId });
    return captureNovelLocationSnapshot(
      await this.request(NOVEL_QUERY_API_OPERATION.locationGet, request),
    );
  }

  async getParagraphCatalog(
    scope: NovelQueryScope,
  ): Promise<NovelParagraphCatalogSnapshot> {
    const request = captureNovelScopedQueryRequest({ scope });
    return captureNovelParagraphCatalogSnapshot(
      await this.request(
        NOVEL_QUERY_API_OPERATION.paragraphCatalogGet,
        request,
      ),
    );
  }

  async getParagraph(
    scope: NovelQueryScope,
    paragraphId: ParagraphId,
  ): Promise<NovelParagraphSnapshot> {
    const request = captureNovelParagraphQueryRequest({ scope, paragraphId });
    return captureNovelParagraphSnapshot(
      await this.request(NOVEL_QUERY_API_OPERATION.paragraphGet, request),
    );
  }

  async getPublicationCatalog(
    scope: NovelQueryScope,
  ): Promise<NovelPublicationCatalogSnapshot> {
    const request = captureNovelScopedQueryRequest({ scope });
    return captureNovelPublicationCatalogSnapshot(
      await this.request(
        NOVEL_QUERY_API_OPERATION.publicationCatalogGet,
        request,
      ),
    );
  }

  private async request(operation: string, payload: unknown): Promise<unknown> {
    const request = Object.freeze({
      protocolVersion: API_PROTOCOL_VERSION,
      requestId: captureRequestId(this.options.requestIdFactory()),
      operation,
      payload,
    }) satisfies ApiRequest;
    if (!isJsonValue(request)) {
      throw new NovelQueryClientProtocolError(
        "Novel query request must contain only JSON-compatible values",
      );
    }
    this.logger.debug("novel_query_client.request_started", {
      operation,
      requestId: request.requestId,
    });
    const response = await this.options.transport.request(request);
    const data = captureApiResponse(response, request.requestId);
    this.logger.debug("novel_query_client.request_completed", {
      operation,
      requestId: request.requestId,
    });
    return data;
  }
}

export class NovelQueryClientProtocolError extends TypeError {
  readonly code = "NOVEL_QUERY_CLIENT_PROTOCOL_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "NovelQueryClientProtocolError";
  }
}

function captureApiResponse<TData>(
  value: ApiResponse<TData>,
  expectedRequestId: string,
): TData {
  const response = captureRecord(value);
  if (
    response.protocolVersion !== API_PROTOCOL_VERSION ||
    response.requestId !== expectedRequestId
  ) {
    throw invalidResponse();
  }
  if (response.ok === false) {
    throw new ApiRemoteError(captureApiErrorSnapshot(response.error));
  }
  if (response.ok !== true || !("data" in response) || !isJsonValue(response.data)) {
    throw invalidResponse();
  }
  return response.data as TData;
}

function captureApiErrorSnapshot(value: unknown): ApiErrorSnapshot {
  const record = captureRecord(value);
  if (
    typeof record.code !== "string" ||
    record.code.trim().length === 0 ||
    !isApiErrorCategory(record.category) ||
    typeof record.retryable !== "boolean" ||
    typeof record.message !== "string" ||
    record.message.trim().length === 0
  ) {
    throw invalidResponse();
  }
  return Object.freeze({
    code: record.code,
    category: record.category,
    retryable: record.retryable,
    message: record.message,
  });
}

function captureRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse();
  }
  return value as Record<string, unknown>;
}

function captureRequestId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NovelQueryClientProtocolError("Novel query request id is invalid");
  }
  return value;
}

function invalidResponse(): NovelQueryClientProtocolError {
  return new NovelQueryClientProtocolError("Novel query API response is invalid");
}
