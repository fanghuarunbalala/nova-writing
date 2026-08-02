/** Compile-only proof for the shared Provider and immutable projection Hook contract. */
import type { NovelApiClient } from "@novel/core";
import {
  NovelApiProvider,
  useConversationProjection,
} from "../src/index.js";

declare const api: NovelApiClient;

function ProjectionConsumer() {
  const result = useConversationProjection("conversation-ui-typecheck");
  void result.resume;
  void result.snapshot.projection.timeline;

  // @ts-expect-error Binding snapshots are immutable.
  result.snapshot.state = "stopped";
  // @ts-expect-error Projected timeline arrays are immutable.
  result.snapshot.projection.timeline.push();
  return null;
}

const tree = (
  <NovelApiProvider api={api}>
    <ProjectionConsumer />
  </NovelApiProvider>
);

void tree;
