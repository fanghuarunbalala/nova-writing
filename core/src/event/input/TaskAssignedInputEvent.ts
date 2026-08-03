/** Internal trusted input that starts a Child Agent turn from an explicit Task. */
import type { ArtifactReference } from "../../storage/artifact/index.js";
import type { InputEventOptions } from "./InputEventOptions.js";
import { INPUT_EVENT_TYPE } from "./InputEventType.js";
import { SystemInputEvent } from "./SystemInputEvent.js";
import { TaskAssignedPayload } from "./payload/TaskAssignedPayload.js";

export interface TaskAssignedInputEventOptions extends InputEventOptions {
  readonly taskId: string;
  readonly requesterConversationId: string;
  readonly prompt: string;
  readonly artifactReferences: readonly ArtifactReference[];
}

export class TaskAssignedInputEvent extends SystemInputEvent {
  constructor(options: TaskAssignedInputEventOptions) {
    super(
      "subagent.task.assigned",
      new TaskAssignedPayload(options),
      options,
    );
  }

  override getEventType(): string {
    return INPUT_EVENT_TYPE.taskAssigned;
  }
}
