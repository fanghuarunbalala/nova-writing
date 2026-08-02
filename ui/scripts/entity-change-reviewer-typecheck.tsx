/** Compile-only proof for separate Character and Location field reviewers. */
import {
  CharacterChangeReviewer,
  LocationChangeReviewer,
  type EntityFieldReviewView,
} from "../src/index.js";

declare const view: EntityFieldReviewView;
const character = <CharacterChangeReviewer view={view} />;
const location = <LocationChangeReviewer view={view} />;

void character;
void location;
