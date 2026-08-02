/** Compile-only proof for immutable shared Novel Change Review identity. */
import {
  NovelChangeReviewShell,
  type NovelChangeReviewView,
} from "../src/index.js";

declare const view: NovelChangeReviewView;
const shell = <NovelChangeReviewShell view={view}>Domain Diff</NovelChangeReviewShell>;

// @ts-expect-error ChangeSet digests must carry a sha256 prefix.
const invalid: NovelChangeReviewView = { ...view, target: { ...view.target, changeSetDigest: "digest" } };

void shell;
void invalid;
