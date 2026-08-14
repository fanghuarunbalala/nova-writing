/**
 * 可变的 Prompt Section 组装器，冻结为不可变精确版本注册表。
 * Mutable Prompt Section assembly that freezes into an immutable exact-version registry.
 */
import type { PromptSection } from "./PromptSection.js";
import { captureSectionId, captureVersion } from "./PromptRecipe.js";

/** 注册表失败码 */
export const PROMPT_SECTION_REGISTRY_FAILURE = {
  duplicateSection: "duplicate_section",
  unknownSection: "unknown_section",
  assemblyFrozen: "assembly_frozen",
} as const;

export type PromptSectionRegistryFailure =
  (typeof PROMPT_SECTION_REGISTRY_FAILURE)[keyof typeof PROMPT_SECTION_REGISTRY_FAILURE];

/** 注册表错误（带失败码与定位信息） */
export class PromptSectionRegistryError extends Error {
  override readonly name = "PromptSectionRegistryError";

  /**
   * 构造注册表错误
   * @param failure 失败码
   * @param sectionId 段 id（定位用）
   * @param version 段版本（定位用）
   */
  constructor(
    readonly failure: PromptSectionRegistryFailure,
    readonly sectionId?: string,
    readonly version?: string,
  ) {
    super(`Prompt Section Registry failed (${failure})`);
  }
}

/**
 * 不可变精确版本注册表：id@version 唯一；resolve 未指定版本时取最新版（semver 排序）。
 * Immutable exact-version registry: unique id@version; resolve returns the latest
 * version (semver order) when no version is requested.
 */
export class PromptSectionRegistry {
  readonly #sections: ReadonlyMap<string, ReadonlyMap<string, PromptSection>>;
  readonly #ordered: readonly PromptSection[];

  /**
   * 构造注册表（校验每个段 id/version/label 与 id@version 唯一性）
   * @param sections 注册段集合
   */
  constructor(sections: Iterable<PromptSection>) {
    const byId = new Map<string, Map<string, PromptSection>>();
    for (const section of sections) {
      if (section === null || typeof section !== "object") {
        throw new TypeError("Prompt Section is invalid");
      }
      const id = captureSectionId(section.id);
      const version = captureVersion(section.version);
      if (typeof section.label !== "string" || section.label.trim().length === 0) {
        throw new TypeError("Prompt Section label is invalid");
      }
      const versions = byId.get(id) ?? new Map<string, PromptSection>();
      if (versions.has(version)) {
        throw registryFailure(
          PROMPT_SECTION_REGISTRY_FAILURE.duplicateSection,
          id,
          version,
        );
      }
      versions.set(version, section);
      byId.set(id, versions);
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

  /**
   * 解析段：指定版本精确匹配；未指定取该 id 最新版（semver 排序）。
   * @param sectionId 段 id
   * @param requestedVersion 精确版本（可选）
   * @returns 注册段
   */
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

  /** 列出全部注册段（id 升序、同 id 版本升序） */
  list(): readonly PromptSection[] {
    return this.#ordered;
  }
}

/** 可变组装器：register 冻结为注册表 */
export class PromptSectionRegistryAssembler {
  readonly #sections = new Map<string, PromptSection>();
  #snapshot?: PromptSectionRegistry;

  /**
   * 注册段（id@version 唯一；冻结后不可再注册）
   * @param section 注册段
   * @returns 组装器（链式）
   */
  register(section: PromptSection): this {
    if (this.#snapshot) {
      throw registryFailure(PROMPT_SECTION_REGISTRY_FAILURE.assemblyFrozen);
    }
    if (section === null || typeof section !== "object") {
      throw new TypeError("Prompt Section is invalid");
    }
    const key = `${captureSectionId(section.id)}@${captureVersion(section.version)}`;
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

  /** 冻结为不可变注册表（幂等） */
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
