/** Compile-only proof for the shared Inspector-to-Composer reference action. */
import {
  ReferenceInConversationButton,
  type ComposerContentReference,
} from "../src/index.js";

declare const reference: ComposerContentReference;
const action = (
  <ReferenceInConversationButton
    reference={reference}
    onReferenced={(captured) => void captured.target}
  />
);

void action;
