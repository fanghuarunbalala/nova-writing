/** Compile-only proof for normalized Outline Tree Diff review. */
import { OutlineChangeReviewer, type OutlineTreeDiffView } from "../src/index.js";

declare const view: OutlineTreeDiffView;
const reviewer = <OutlineChangeReviewer view={view} />;

void reviewer;
