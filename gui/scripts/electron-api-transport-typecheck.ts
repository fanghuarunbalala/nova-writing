/** Compile-only proof for the Renderer-owned Electron ApiTransport boundary. */
import type {
  ApiRequest,
  ApiResponse,
  ApiSubscription,
  ApiTransport,
} from "@novel/core";
import { ElectronApiTransport } from "../src/renderer/index.js";
import type {
  ElectronBridgeAcknowledgement,
  ElectronBridgeResult,
  ElectronBridgeSubscriptionRead,
  ElectronPreloadBridge,
} from "../src/shared/index.js";

const acknowledgement = (): ElectronBridgeResult<ElectronBridgeAcknowledgement> => ({
  ok: true,
  value: { acknowledged: true },
});

const bridge: ElectronPreloadBridge = {
  async request(request): Promise<ElectronBridgeResult<ApiResponse>> {
    return {
      ok: true,
      value: {
        protocolVersion: request.protocolVersion,
        requestId: request.requestId,
        ok: true,
        data: null,
      },
    };
  },
  async cancelRequest() {
    return acknowledgement();
  },
  async openSubscription() {
    return acknowledgement();
  },
  async readSubscription(): Promise<
    ElectronBridgeResult<ElectronBridgeSubscriptionRead>
  > {
    return { ok: true, value: { done: true } };
  },
  async closeSubscription() {
    return acknowledgement();
  },
};

const request: ApiRequest = {
  protocolVersion: 1,
  requestId: "request-typecheck",
  operation: "test.request",
  payload: null,
};
const transport: ApiTransport = new ElectronApiTransport({ bridge });
const response: Promise<ApiResponse<{ readonly accepted: true }>> =
  transport.request(request);
const subscription: ApiSubscription = transport.subscribe({
  ...request,
  requestId: "subscription-typecheck",
  operation: "test.subscribe",
});

void response;
void subscription;
