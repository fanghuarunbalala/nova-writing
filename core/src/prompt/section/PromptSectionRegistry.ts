/** Mutable Prompt Section assembly that freezes into an immutable exact-version Registry. */
import { PromptSection } from "./PromptSection.js";
import {
  captureSectionId,
  captureVersion,
} from "../PromptPlanItem.js";

export const PROMPT_SECTION_REGISTRY_FAILURE = {
  duplicateSection: "duplicate_section",
  unknownSection: "unknown_section",
  assemblyFrozen: "assembly_frozen",
} as const;

export type PromptSectionRegistryFailure =
  (typeof PROMPT_SECTION_REGISTRY_FAILURE)[keyof typeof PROMPT_SECTION_REGISTRY_FAILURE];

export class PromptSectionRegistryError extends Error {
  override readonly name = "PromptSectionRegistryError";

  constructor(
    readonly failure: PromptSectionRegistryFailure,
    readonly sectionId?: string,
    readonly version?: string,
  ) {
    super(`Prompt Section Registry failed (${failure})`);
  }
}

export class PromptSectionRegistry {
  readonly #sections: ReadonlyMap<string, ReadonlyMap<string, PromptSection>>;
  readonly #ordered: readonly PromptSection[];

  constructor(sections: Iterable<PromptSection>) {
    const byId = new Map<string, Map<string, PromptSection>>();
    for (const section of sections) {
      if (!(section instanceof PromptSection)) {
        throw new TypeError("Prompt Section is invalid");
      }
      const versions = byId.get(section.id) ?? new Map<string, PromptSection>();
      if (versions.has(section.version)) {
        throw registryFailure(
          PROMPT_SECTION_REGISTRY_FAILURE.duplicateSection,
          section.id,
          section.version,
        );
      }
      versions.set(section.version, section);
      byId.set(section.id, versions);
    }
    this.#sections = new Map(
      [...byId].map(([sectionId, versions]) => [sectionId, new Map(versions)]),
    );
    this.#ordered = Object.freeze(
      [...byId.values()]
        .flatMap((versions) => [...versions.values()])
        .sort(compareSections),
    );
    Object.freeze(this);
  }

  resolve(sectionId: string, requestedVersion?: string): PromptSection {
    const capturedId = captureSectionId(sectionId);
    const versions = this.#sections.get(capturedId);
    if (!versions) {
      throw registryFailure(
        PROMPT_SECTION_REGISTRY_FAILURE.unknownSection,
        capturedId,
        requestedVersion,
      );
    }
    if (requestedVersion !== undefined) {
      const capturedVersion = captureVersion(requestedVersion);
      const section = versions.get(capturedVersion);
      if (!section) {
        throw registryFailure(
          PROMPT_SECTION_REGISTRY_FAILURE.unknownSection,
          capturedId,
          capturedVersion,
        );
      }
      return section;
    }
    return [...versions.values()].sort(compareVersions).at(-1)!;
  }

  list(): readonly PromptSection[] {
    return this.#ordered;
  }
}

export class PromptSectionRegistryAssembler {
  readonly #sections = new Map<string, PromptSection>();
  #snapshot?: PromptSectionRegistry;

  register(section: PromptSection): this {
    if (this.#snapshot) {
      throw registryFailure(PROMPT_SECTION_REGISTRY_FAILURE.assemblyFrozen);
    }
    if (!(section instanceof PromptSection)) {
      throw new TypeError("Prompt Section is invalid");
    }
    const key = `${section.id}@${section.version}`;
    if (this.#sections.has(key)) {
      throw registryFailure(
        PROMPT_SECTION_REGISTRY_FAILURE.duplicateSection,
        section.id,
        section.version,
      );
    }
    this.#sections.set(key, section);
    return this;
  }

  freeze(): PromptSectionRegistry {
    this.#snapshot ??= new PromptSectionRegistry(this.#sections.values());
    return this.#snapshot;
  }
}

function compareSections(left: PromptSection, right: PromptSection): number {
  return left.id === right.id
    ? compareVersions(left, right)
    : left.id.localeCompare(right.id);
}

function compareVersions(left: PromptSection, right: PromptSection): number {
  const leftParts = left.version.split(".").map(Number);
  const rightParts = right.version.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function registryFailure(
  failure: PromptSectionRegistryFailure,
  sectionId?: string,
  version?: string,
): PromptSectionRegistryError {
  return new PromptSectionRegistryError(failure, sectionId, version);
}
