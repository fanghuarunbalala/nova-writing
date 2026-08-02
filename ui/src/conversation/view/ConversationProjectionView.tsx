/** Presentational Conversation view driven by one shared Hook result. */
import type { ConversationProjectionHookResult } from "../useConversationProjection.js";
import { ConversationConnectionStatus } from "./ConversationConnectionStatus.js";
import { ConversationTimeline } from "./ConversationTimeline.js";

export interface ConversationProjectionViewProps {
  readonly result: ConversationProjectionHookResult;
  readonly diagnostics?: boolean;
}

export function ConversationProjectionView({
  result,
  diagnostics,
}: ConversationProjectionViewProps) {
  const controllerState = result.snapshot.controller?.state ?? result.snapshot.state;
  const runtimePresence = result.snapshot.controller?.runtimePresence;
  return (
    <section className="novel-conversation-view" data-controller-state={controllerState}>
      <header className="novel-conversation-header">
        <span>Conversation</span>
        {runtimePresence !== undefined ? (
          <span className="novel-runtime-presence" data-runtime-state={runtimePresence.state}>
            Runtime {runtimePresence.state}
          </span>
        ) : null}
      </header>
      {controllerState !== "live" ? (
        <ConversationConnectionStatus snapshot={result.snapshot} resume={result.resume} />
      ) : null}
      <ConversationTimeline
        projection={result.snapshot.projection}
        diagnostics={diagnostics}
      />
    </section>
  );
}
