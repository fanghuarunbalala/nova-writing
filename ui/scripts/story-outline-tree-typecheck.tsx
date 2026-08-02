/** Compile-only proof for accessible Story Outline React presentation. */
import {
  StoryOutlineTree,
  StoryOutlineTreeController,
  type StoryOutlineTreeView,
} from "../src/index.js";

declare const view: StoryOutlineTreeView;
const controller = new StoryOutlineTreeController({ view });
const tree = (
  <StoryOutlineTree
    controller={controller}
    onSelect={(storyUnitId) => storyUnitId.toUpperCase()}
  />
);

void tree;
