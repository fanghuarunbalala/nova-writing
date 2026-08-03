/** Compile-time usage example for the durable TaskAssigned InputEvent boundary. */
import {
  TaskAssignedInputEvent,
  type ArtifactReference,
} from "../src/index.js";

const artifactReferences: readonly ArtifactReference[] = [];
const event = new TaskAssignedInputEvent({
  conversationId: "conversation-child-1",
  taskId: "task-1",
  requesterConversationId: "conversation-parent-1",
  prompt: "Plan the next chapter.",
  artifactReferences,
});

void event.getSnapshot();
