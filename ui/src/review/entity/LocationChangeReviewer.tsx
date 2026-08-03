/** Location-specific field reviewer over the shared entity Diff primitives. */
import { captureEntityFieldReviewView, type EntityFieldReviewView } from "./EntityFieldDiffView.js";
import {
  EntityFieldDiffList,
  type EntityFieldReferenceResolver,
} from "./EntityFieldDiffList.js";

export interface LocationChangeReviewerProps {
  readonly view: EntityFieldReviewView;
  readonly referenceForField?: EntityFieldReferenceResolver;
}

export function LocationChangeReviewer({
  view: input,
  referenceForField,
}: LocationChangeReviewerProps) {
  const view = captureEntityFieldReviewView(input);
  return (
    <section className="novel-entity-change-reviewer" data-entity-domain="location">
      <header>
        <span>地点变更</span>
        <h3>{view.entityName}</h3>
      </header>
      <EntityFieldDiffList view={view} referenceForField={referenceForField} />
    </section>
  );
}
