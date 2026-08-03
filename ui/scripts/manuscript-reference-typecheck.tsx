/** Compile-only proof for query-adapter-owned Manuscript Block references. */
import {
  ManuscriptChangeReviewer,
  type ComposerContentReference,
  type ManuscriptBlockDiffView,
} from "../src/index.js";

declare const view: ManuscriptBlockDiffView;
declare const reference: ComposerContentReference;
const reviewer = (
  <ManuscriptChangeReviewer
    view={view}
    referenceForBlock={(row, currentView) => {
      void row.blockId;
      void currentView.rows.length;
      return reference;
    }}
  />
);

void reviewer;
