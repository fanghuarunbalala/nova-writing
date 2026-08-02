/** Compile-only proof for immutable normalized Story Outline view state. */
import {
  StoryOutlineTreeController,
  type StoryOutlineTreeView,
} from "../src/index.js";

declare const view: StoryOutlineTreeView;
const controller = new StoryOutlineTreeController({ view });
const snapshot = controller.getSnapshot();

// @ts-expect-error Outline snapshots are immutable.
snapshot.visibleRows = [];
// @ts-expect-error Node child identities are immutable.
snapshot.view.nodes.root.childIds.push("replacement");

void controller;
