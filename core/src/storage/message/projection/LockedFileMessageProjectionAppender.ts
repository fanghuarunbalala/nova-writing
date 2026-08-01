/** Adapts a locked Message file to the streaming batch-appender protocol. */
import type {
  LockedConversationMessageFile,
  MessageProjectionReplacementWriter,
} from "../file/index.js";
import type {
  MessageProjectionFileRecord,
  MessageProjectionSequenceState,
} from "../protocol/index.js";
import { MessageProjectionInvariantError } from "./MessageProjectionMaintenanceErrors.js";

export class LockedFileMessageProjectionAppender
  implements MessageProjectionReplacementWriter
{
  readonly conversationId: string;

  private state: MessageProjectionSequenceState;

  constructor(
    private readonly file: LockedConversationMessageFile,
    initialState: MessageProjectionSequenceState,
  ) {
    this.conversationId = initialState.conversationId;
    this.state = initialState;
  }

  getState(): MessageProjectionSequenceState {
    return { ...this.state };
  }

  async appendCommittedBatch(
    records: readonly MessageProjectionFileRecord[],
  ): Promise<MessageProjectionSequenceState> {
    const scan = await this.file.appendCommittedBatch(records);
    if (scan.status !== "valid" || scan.state === undefined) {
      throw new MessageProjectionInvariantError(
        "Locked Message file append did not return a valid committed state",
      );
    }
    this.state = scan.state;
    return { ...this.state };
  }
}
