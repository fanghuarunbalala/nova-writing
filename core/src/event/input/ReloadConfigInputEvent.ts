import type { CoreConfig } from "../../config/index.js";
import { CommandInputEvent } from "./CommandInputEvent.js";
import type { InputEventOptions } from "./InputEventOptions.js";
import { INPUT_EVENT_TYPE } from "./InputEventType.js";
import { ReloadConfigPayload } from "./payload/ReloadConfigPayload.js";

export interface ReloadConfigInputEventOptions extends InputEventOptions {
  config: CoreConfig;
}

export class ReloadConfigInputEvent extends CommandInputEvent {
  constructor(options: ReloadConfigInputEventOptions) {
    super("config.reload", new ReloadConfigPayload(options.config), options);
  }

  override getEventType(): string {
    return INPUT_EVENT_TYPE.reloadConfig;
  }
}
