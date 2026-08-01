/** Converts Core-owned canonical Messages only at the private Pi boundary. */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { RuntimeMessageSnapshot } from "../../message/index.js";

export const PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE = {
  context: "context",
  prompt: "prompt",
} as const;

export type PiRuntimeMessageConversionPurpose =
  (typeof PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE)[keyof typeof PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE];

export interface PiRuntimeMessageConversionRequest {
  readonly conversationId: string;
  readonly runId: string;
  readonly purpose: PiRuntimeMessageConversionPurpose;
  readonly messages: readonly RuntimeMessageSnapshot[];
}

export interface PiRuntimeMessageConverter {
  convert(request: PiRuntimeMessageConversionRequest): Promise<readonly AgentMessage[]>;
}
