/** Compile-only proof for the internal Pi Provider execution factory. */
import type { CredentialVault, EffectiveModelExecutionDescriptor } from "../src/config/index.js";
import {
  PiAiProviderExecutionDispatcher,
  PiProviderExecutionFactory,
  classifyProviderFailure,
  createErrorAssistantMessage,
  createPiExecutionModel,
  isSupportedPiExecutionApi,
  type PiDispatchAwareStreamFunction,
} from "../src/runtime/agent/pi/index.js";

declare const descriptor: EffectiveModelExecutionDescriptor;
declare const credentials: CredentialVault;

const dispatcher = new PiAiProviderExecutionDispatcher();
const factory = new PiProviderExecutionFactory({ dispatcher, credentials });
const streamFunction: PiDispatchAwareStreamFunction = factory.create(descriptor);
void streamFunction;
void classifyProviderFailure({ message: "x", status: 429 });
void isSupportedPiExecutionApi("openai-responses");
void createErrorAssistantMessage("network", "openai-responses");
void createPiExecutionModel;
