/** Production Pi Provider stream dispatcher over the accepted four APIs. */
import {
  streamSimple as anthropicMessagesStreamSimple,
} from "@earendil-works/pi-ai/api/anthropic-messages";
import {
  streamSimple as googleGenerativeAiStreamSimple,
} from "@earendil-works/pi-ai/api/google-generative-ai";
import {
  streamSimple as openaiCompletionsStreamSimple,
} from "@earendil-works/pi-ai/api/openai-completions";
import {
  streamSimple as openaiResponsesStreamSimple,
} from "@earendil-works/pi-ai/api/openai-responses";
import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { PiProviderExecutionError } from "./PiProviderExecutionErrors.js";
import type {
  PiProviderExecutionDispatcher,
  SupportedPiExecutionApi,
} from "./PiProviderExecutionFactory.js";

type PiProviderStream = (
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
) => AssistantMessageEventStream;

const API_STREAMS: Readonly<Record<SupportedPiExecutionApi, PiProviderStream>> =
  Object.freeze({
    "openai-completions": openaiCompletionsStreamSimple as PiProviderStream,
    "openai-responses": openaiResponsesStreamSimple as PiProviderStream,
    "anthropic-messages": anthropicMessagesStreamSimple as PiProviderStream,
    "google-generative-ai": googleGenerativeAiStreamSimple as PiProviderStream,
});

export class PiAiProviderExecutionDispatcher
  implements PiProviderExecutionDispatcher
{
  stream(
    api: SupportedPiExecutionApi,
    model: Model<Api>,
    context: Context,
    options: SimpleStreamOptions,
  ): AssistantMessageEventStream {
    const stream = API_STREAMS[api];
    if (stream === undefined) {
      throw new PiProviderExecutionError("unsupported_api");
    }
    return stream(model, context, options);
  }
}
