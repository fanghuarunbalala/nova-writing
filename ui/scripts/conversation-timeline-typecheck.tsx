/** Compile-only proof for read-only Timeline and Hook-connected Conversation views. */
import type { ConversationProjectionSnapshot } from "@novel/core";
import { ConversationTimeline, ConversationView } from "../src/index.js";

declare const projection: ConversationProjectionSnapshot;

const timeline = <ConversationTimeline projection={projection} diagnostics />;
const view = <ConversationView conversationId="conversation-ui-timeline" />;

// @ts-expect-error Projection input remains immutable.
projection.timeline.push();

void timeline;
void view;
