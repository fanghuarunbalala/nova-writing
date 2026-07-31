import type { CoreConfig } from "../../../config/index.js";
import type { JsonObject } from "../../protocol/JsonValue.js";
import { EventPayload } from "./EventPayload.js";

export class ReloadConfigPayload extends EventPayload {
  constructor(public readonly config: CoreConfig) {
    super();
  }

  toObject(): JsonObject {
    return {
      config: {
        runtime: this.config.runtime,
        locale: this.config.locale,
      },
    };
  }
}
