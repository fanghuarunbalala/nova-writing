/** Immutable exact-version catalog used to constrain one Agent's permitted Subagents. */
import {
  SUBAGENT_TASK_PROTOCOL_FAILURE,
  SubagentTaskProtocolError,
} from "./SubagentTaskProtocolErrors.js";
import type { SubagentDefinition } from "./SubagentTaskProtocol.js";
import { captureSubagentDefinition } from "./SubagentTaskProtocolValidator.js";

const SAFE_AGENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface SubagentDefinitionReader {
  get(agentType: string): SubagentDefinition | undefined;
  require(agentType: string): SubagentDefinition;
  list(): readonly SubagentDefinition[];
}

export class SubagentDefinitionCatalog implements SubagentDefinitionReader {
  readonly #definitionsByType: ReadonlyMap<string, SubagentDefinition>;
  readonly #orderedDefinitions: readonly SubagentDefinition[];

  constructor(definitions: Iterable<SubagentDefinition>) {
    const definitionsByType = new Map<string, SubagentDefinition>();
    for (const source of definitions) {
      const definition = captureSubagentDefinition(source);
      if (definitionsByType.has(definition.agentType)) {
        throw new SubagentTaskProtocolError(
          SUBAGENT_TASK_PROTOCOL_FAILURE.duplicateDefinition,
          undefined,
          definition.agentType,
        );
      }
      definitionsByType.set(definition.agentType, definition);
    }
    this.#definitionsByType = definitionsByType;
    this.#orderedDefinitions = Object.freeze(
      [...definitionsByType.values()].sort(compareDefinitions),
    );
    Object.freeze(this);
  }

  get size(): number {
    return this.#orderedDefinitions.length;
  }

  has(agentType: string): boolean {
    return this.#definitionsByType.has(agentType);
  }

  get(agentType: string): SubagentDefinition | undefined {
    return this.#definitionsByType.get(agentType);
  }

  require(agentType: string): SubagentDefinition {
    const definition = this.get(agentType);
    if (!definition) {
      throw new SubagentTaskProtocolError(
        SUBAGENT_TASK_PROTOCOL_FAILURE.unknownDefinition,
        undefined,
        SAFE_AGENT_TYPE.test(agentType) ? agentType : undefined,
      );
    }
    return definition;
  }

  list(): readonly SubagentDefinition[] {
    return this.#orderedDefinitions;
  }
}

function compareDefinitions(
  left: SubagentDefinition,
  right: SubagentDefinition,
): number {
  if (left.agentType < right.agentType) return -1;
  if (left.agentType > right.agentType) return 1;
  return 0;
}
