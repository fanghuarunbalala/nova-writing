/** Projects Core-owned user input events into provider-independent user messages. */
import {
  INPUT_EVENT_TYPE,
  isAgentTurnInputEventType,
} from "../../../event/index.js";
import type { PersistedConversationEventSnapshot } from "../../../storage/index.js";
import { RUNTIME_MESSAGE_SCHEMA_VERSION, type RuntimeMessageDraft } from "../RuntimeMessageSnapshot.js";
import { CORE_RUNTIME_MESSAGE_TYPE } from "../schema/CoreRuntimeMessageSchemas.js";
import { RuntimeMessageProjectionError } from "./RuntimeMessageProjectionError.js";
import type { RuntimeMessageProjector } from "./RuntimeMessageProjector.js";

export class CoreRuntimeMessageProjector implements RuntimeMessageProjector {
  readonly id = "core.input-message";
  readonly version = "1";

  project(event: PersistedConversationEventSnapshot): readonly RuntimeMessageDraft[] {
    if (event.direction !== "input" || !isAgentTurnInputEventType(event.eventType)) {
      return [];
    }

    const text = event.eventType === INPUT_EVENT_TYPE.taskAssigned
      ? event.payload.prompt
      : event.payload.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new RuntimeMessageProjectionError(
        "User message event payload does not contain valid text",
        this.id,
        event.id,
      );
    }

    return [
      {
        role: "user",
        messageType: CORE_RUNTIME_MESSAGE_TYPE.userMessage,
        schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
        timestamp: event.timestamp,
        ...(event.runId !== undefined ? { runId: event.runId } : {}),
        ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
        payload: {
          content: [
            {
              type: "text",
              text,
            },
          ],
        },
      },
    ];
  }
}
