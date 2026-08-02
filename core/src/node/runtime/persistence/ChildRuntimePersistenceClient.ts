/** Child-side Runtime persistence client exposing only typed narrow Ports. */
import type { JsonValue } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  RUNTIME_PERSISTENCE_RPC_METHOD,
  RuntimeIpcRemoteError,
  RuntimeIpcRequestCancelledError,
  RuntimePersistenceRequestError,
  captureRuntimeJournalAppendOutputReceipt,
  captureRuntimeJournalAppendOutputRequest,
  captureRuntimeJournalGetEventRequest,
  captureRuntimeJournalGetEventResponse,
  captureRuntimeJournalListEventsRequest,
  captureRuntimeJournalListEventsResponse,
  captureRuntimeMessagesListRequest,
  captureRuntimeMessagesListResponse,
  captureRuntimeRecoverySnapshot,
  captureRuntimeStateLoadRequest,
  encodeRuntimePersistencePayload,
  type RuntimeIpcRequestOptions,
  type RuntimeJournalPersistencePort,
  type RuntimeMessagePersistencePort,
  type RuntimePersistencePorts,
  type RuntimePersistenceRequestOptions,
  type RuntimePersistenceRpcMethod,
  type RuntimeStatePersistencePort,
} from "../../../runtime/ipc/index.js";

export interface RuntimePersistenceRpcRequester {
  request(
    method: string,
    payload: JsonValue,
    options?: RuntimeIpcRequestOptions,
  ): Promise<JsonValue>;
}

export interface ChildRuntimePersistenceClientOptions {
  readonly requester: RuntimePersistenceRpcRequester;
  readonly logger?: Logger;
}

export class ChildRuntimePersistenceClient implements RuntimePersistencePorts {
  readonly journal: RuntimeJournalPersistencePort;
  readonly messages: RuntimeMessagePersistencePort;
  readonly runtimeState: RuntimeStatePersistencePort;
  readonly #requester: RuntimePersistenceRpcRequester;
  readonly #logger: Logger;

  constructor(options: ChildRuntimePersistenceClientOptions) {
    this.#requester = options.requester;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "child_runtime_persistence_client",
    });
    this.journal = Object.freeze({
      getEvent: async (conversationId, sequence, requestOptions) => {
        const request = captureRuntimeJournalGetEventRequest({ conversationId, sequence });
        const response = captureRuntimeJournalGetEventResponse(
          await this.#request(RUNTIME_PERSISTENCE_RPC_METHOD.journalGetEvent, request, requestOptions),
          request,
        );
        return response.found ? response.event : undefined;
      },
      listEvents: async (query, requestOptions) => {
        const request = captureRuntimeJournalListEventsRequest(query);
        return captureRuntimeJournalListEventsResponse(
          await this.#request(RUNTIME_PERSISTENCE_RPC_METHOD.journalListEvents, request, requestOptions),
          request,
        );
      },
      appendOutput: async (conversationId, snapshot, requestOptions) => {
        const request = captureRuntimeJournalAppendOutputRequest({ conversationId, snapshot });
        return captureRuntimeJournalAppendOutputReceipt(
          await this.#request(RUNTIME_PERSISTENCE_RPC_METHOD.journalAppendOutput, request, requestOptions),
          request,
        );
      },
    } satisfies RuntimeJournalPersistencePort);
    this.messages = Object.freeze({
      list: async (query, requestOptions) => {
        const request = captureRuntimeMessagesListRequest(query);
        return captureRuntimeMessagesListResponse(
          await this.#request(RUNTIME_PERSISTENCE_RPC_METHOD.messagesList, request, requestOptions),
          request,
        );
      },
    } satisfies RuntimeMessagePersistencePort);
    this.runtimeState = Object.freeze({
      load: async (conversationId, requestOptions) => {
        const request = captureRuntimeStateLoadRequest({ conversationId });
        return captureRuntimeRecoverySnapshot(
          await this.#request(RUNTIME_PERSISTENCE_RPC_METHOD.runtimeStateLoad, request, requestOptions),
          request.conversationId,
        );
      },
    } satisfies RuntimeStatePersistencePort);
    Object.freeze(this);
  }

  async #request(
    method: RuntimePersistenceRpcMethod,
    request: unknown,
    options?: RuntimePersistenceRequestOptions,
  ): Promise<JsonValue> {
    this.#logger.debug("runtime.persistence.client_request_started", { method });
    try {
      const response = await this.#requester.request(
        method,
        encodeRuntimePersistencePayload(request),
        { signal: options?.signal },
      );
      this.#logger.debug("runtime.persistence.client_request_completed", { method });
      return response;
    } catch (error) {
      if (
        error instanceof RuntimeIpcRequestCancelledError ||
        (error instanceof RuntimeIpcRemoteError && error.category === "cancelled")
      ) {
        throw new RuntimePersistenceRequestError(method, "cancelled");
      }
      throw new RuntimePersistenceRequestError(method, "remote_failure");
    }
  }
}
