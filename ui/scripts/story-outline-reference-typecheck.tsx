/** Compile-only proof for query-adapter-owned StoryUnit reference resolution. */
import {
  StoryOutlineTree,
  StoryOutlineTreeController,
  type ComposerContentReference,
  type StoryOutlineTreeView,
} from "../src/index.js";

declare const view: StoryOutlineTreeView;
declare const reference: ComposerContentReference;
const controller = new StoryOutlineTreeController({ view });
const tree = (
  <StoryOutlineTree
    controller={controller}
    referenceForStoryUnit={(node, currentView) => {
      void node.id;
      void currentView.sourceRevision;
      return reference;
    }}
  />
);

void tree;
