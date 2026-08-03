/** Compile-only proof for separate Character and Location field references. */
import {
  CharacterChangeReviewer,
  LocationChangeReviewer,
  type ComposerContentReference,
  type EntityFieldReviewView,
} from "../src/index.js";

declare const view: EntityFieldReviewView;
declare const reference: ComposerContentReference;
const character = (
  <CharacterChangeReviewer
    view={view}
    referenceForField={(field, currentView) => {
      void field.fieldId;
      void currentView.entityId;
      return reference;
    }}
  />
);
const location = (
  <LocationChangeReviewer
    view={view}
    referenceForField={() => reference}
  />
);

void character;
void location;
