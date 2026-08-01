/** Reads the active Pi Agent model without persisting it in canonical history. */
import type { PiAgentCoreClient } from "./PiAgentCoreClient.js";
import type {
  PiAssistantMessageEnvelope,
  PiAssistantMessageEnvelopeFactory,
} from "./PiAssistantMessageEnvelopeFactory.js";

export class PiAgentCoreAssistantMessageEnvelopeFactory
  implements PiAssistantMessageEnvelopeFactory
{
  constructor(private readonly agent: PiAgentCoreClient) {}

  create(): PiAssistantMessageEnvelope {
    const model = this.agent.state.model;
    const api = captureNonBlank(model?.api);
    const provider = captureNonBlank(model?.provider);
    const modelId = captureNonBlank(model?.id);
    if (api === undefined || provider === undefined || modelId === undefined) {
      throw new TypeError("Active Pi model identity is invalid");
    }
    return Object.freeze({ api, provider, model: modelId });
  }
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
