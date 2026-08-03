/** Immutable exact-version Agent Definition catalog with optional latest resolution. */
import {
  AgentDefinition,
  captureAgentType,
} from "./AgentDefinition.js";

export class AgentDefinitionCatalog {
  readonly #definitions: ReadonlyMap<string, ReadonlyMap<string, AgentDefinition>>;
  readonly #ordered: readonly AgentDefinition[];

  constructor(definitions: Iterable<AgentDefinition>) {
    const byType = new Map<string, Map<string, AgentDefinition>>();
    for (const definition of definitions) {
      if (!(definition instanceof AgentDefinition)) {
        throw new TypeError("Agent Definition is invalid");
      }
      const versions = byType.get(definition.agentType) ?? new Map();
      if (versions.has(definition.definitionVersion)) {
        throw new TypeError("Agent Definition identity must be unique");
      }
      versions.set(definition.definitionVersion, definition);
      byType.set(definition.agentType, versions);
    }
    this.#definitions = new Map(
      [...byType].map(([agentType, versions]) => [agentType, new Map(versions)]),
    );
    this.#ordered = Object.freeze(
      [...byType.values()]
        .flatMap((versions) => [...versions.values()])
        .sort(compareDefinitions),
    );
    Object.freeze(this);
  }

  resolve(agentType: string, definitionVersion?: string): AgentDefinition {
    const capturedType = captureAgentType(agentType);
    const versions = this.#definitions.get(capturedType);
    if (!versions) throw new TypeError("Agent Definition is unknown");
    if (definitionVersion !== undefined) {
      const definition = versions.get(definitionVersion);
      if (!definition) throw new TypeError("Agent Definition is unknown");
      return definition;
    }
    return [...versions.values()].sort(compareVersions).at(-1)!;
  }

  list(): readonly AgentDefinition[] {
    return this.#ordered;
  }
}

function compareDefinitions(left: AgentDefinition, right: AgentDefinition): number {
  return left.agentType === right.agentType
    ? compareVersions(left, right)
    : left.agentType.localeCompare(right.agentType);
}

function compareVersions(left: AgentDefinition, right: AgentDefinition): number {
  const leftParts = left.definitionVersion.split(".").map(Number);
  const rightParts = right.definitionVersion.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}
