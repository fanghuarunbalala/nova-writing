/** Character-specific field reviewer over the shared entity Diff primitives. */
import { captureEntityFieldReviewView, type EntityFieldReviewView } from "./EntityFieldDiffView.js";
import { EntityFieldDiffList } from "./EntityFieldDiffList.js";

export function CharacterChangeReviewer({ view: input }: { readonly view: EntityFieldReviewView }) {
  const view = captureEntityFieldReviewView(input);
  return (
    <section className="novel-entity-change-reviewer" data-entity-domain="character">
      <header>
        <span>人物变更</span>
        <h3>{view.entityName}</h3>
      </header>
      <EntityFieldDiffList view={view} />
    </section>
  );
}
