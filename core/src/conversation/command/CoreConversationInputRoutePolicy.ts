/**
 * Default Host routing policy for Core and Agent-defined InputEvents.
 *
 * Agent-defined inputs default to Runtime activation after their schemas have
 * been accepted by the configured EventSchemaRegistry.
 */
import {
  INPUT_EVENT_TYPE,
  type InputEventSnapshot,
} from "../../event/index.js";
import type { ConversationInputRoute } from "./ConversationInputRoute.js";
import type { ConversationInputRoutePolicy } from "./ConversationInputRoutePolicy.js";

const REQUIRED_RUNTIME_ROUTE = Object.freeze({
  target: "runtime",
  activation: "required",
}) satisfies ConversationInputRoute;

const STOP_ROUTE = Object.freeze({
  target: "host",
  handler: "stop",
  runtimeNotification: "if_online",
}) satisfies ConversationInputRoute;

const RELOAD_CONFIG_ROUTE = Object.freeze({
  target: "host",
  handler: "reload_config",
  runtimeNotification: "if_online",
}) satisfies ConversationInputRoute;

export class CoreConversationInputRoutePolicy
  implements ConversationInputRoutePolicy
{
  resolve(snapshot: InputEventSnapshot): ConversationInputRoute {
    switch (snapshot.eventType) {
      case INPUT_EVENT_TYPE.systemStop:
        return STOP_ROUTE;
      case INPUT_EVENT_TYPE.reloadConfig:
        return RELOAD_CONFIG_ROUTE;
      default:
        return REQUIRED_RUNTIME_ROUTE;
    }
  }
}
