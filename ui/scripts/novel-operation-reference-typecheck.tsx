/** Compile-only proof for immutable ChangeSet Operation reference resolution. */
import {
  NovelChangeReviewShell,
  type ComposerContentReference,
  type NovelChangeReviewView,
} from "../src/index.js";

declare const view: NovelChangeReviewView;
declare const reference: ComposerContentReference;
const shell = (
  <NovelChangeReviewShell
    view={view}
    referenceForOperation={(operationId, currentView) => {
      void operationId;
      void currentView.target.changeSetDigest;
      return reference;
    }}
  />
);

void shell;
