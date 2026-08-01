/** Pure routing boundary for validated InputEvent snapshots. */
import type { InputEventSnapshot } from "../../event/index.js";
import type { ConversationInputRoute } from "./ConversationInputRoute.js";

export interface ConversationInputRoutePolicy {
  resolve(snapshot: InputEventSnapshot): ConversationInputRoute;
}
