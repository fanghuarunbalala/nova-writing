/** Compile-only proof for stable Block-oriented Manuscript review. */
import { ManuscriptChangeReviewer, type ManuscriptBlockDiffView } from "../src/index.js";

declare const view: ManuscriptBlockDiffView;
const reviewer = <ManuscriptChangeReviewer view={view} />;

void reviewer;
