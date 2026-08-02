/** Compile-only proof for generic InputEvent enqueue and Composer contracts. */
import type { InputEvent, InputReceipt } from "@novel/core";
import { ConversationComposer, type ConversationProjectionHookResult } from "../src/index.js";

declare const result: ConversationProjectionHookResult;
declare const event: InputEvent;
const receipt: Promise<InputReceipt> = result.enqueue(event);
const composer = (
  <ConversationComposer
    conversationId="conversation-composer"
    enabled
    enqueue={result.enqueue}
  />
);

void receipt;
void composer;
