/**
 * Converts deterministic Runtime Message drafts into persisted snapshots while
 * retaining the source ordinal required by Message projection records.
 */
import type { PersistedConversationEventSnapshot } from "../../journal/index.js";
import type {
  RuntimeMessageDraft,
  RuntimeMessageSchemaRegistry,
  RuntimeMessageSnapshot,
} from "../../../runtime/index.js";
import type { MessageProjectionIdentity } from "./MessageProjectionIdentity.js";
import type { RuntimeMessageIdFactory } from "./RuntimeMessageIdFactory.js";

export interface MaterializedRuntimeMessage {
  ordinal: number;
  snapshot: RuntimeMessageSnapshot;
}

export interface RuntimeMessageMaterializerOptions {
  idFactory: RuntimeMessageIdFactory;
  messageSchemaRegistry: RuntimeMessageSchemaRegistry;
}

export class RuntimeMessageMaterializer {
  private readonly idFactory: RuntimeMessageIdFactory;
  private readonly messageSchemaRegistry: RuntimeMessageSchemaRegistry;

  constructor(options: RuntimeMessageMaterializerOptions) {
    this.idFactory = options.idFactory;
    this.messageSchemaRegistry = options.messageSchemaRegistry;
  }

  materialize(
    event: PersistedConversationEventSnapshot,
    projector: MessageProjectionIdentity,
    drafts: readonly RuntimeMessageDraft[],
  ): readonly MaterializedRuntimeMessage[] {
    this.assertIdentity(projector);

    return drafts.map((draft, ordinal) => {
      const validatedDraft = this.messageSchemaRegistry.validateDraft(draft);
      const snapshot: RuntimeMessageSnapshot = {
        ...validatedDraft,
        id: this.idFactory.create({
          conversationId: event.conversationId,
          projectorId: projector.projectorId,
          projectorVersion: projector.projectorVersion,
          eventId: event.id,
          eventSequence: event.sequence,
          ordinal,
        }),
        conversationId: event.conversationId,
      };
      return {
        ordinal,
        snapshot: this.messageSchemaRegistry.validateSnapshot(snapshot),
      };
    });
  }

  private assertIdentity(identity: MessageProjectionIdentity): void {
    if (identity.projectorId.trim().length === 0) {
      throw new TypeError("projectorId must not be blank");
    }
    if (identity.projectorVersion.trim().length === 0) {
      throw new TypeError("projectorVersion must not be blank");
    }
  }
}
