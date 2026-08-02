/** Compile-only proof for immutable Inspector renderer registration. */
import {
  InspectorRendererRegistry,
  type InspectorRendererProps,
} from "../src/index.js";

function CharacterInspector({ target }: InspectorRendererProps) {
  return <article>{target.title}</article>;
}

const registry = new InspectorRendererRegistry([
  { kind: "character", renderer: CharacterInspector },
]);
const extended = registry.withRenderer("location", CharacterInspector);

void registry;
void extended;
