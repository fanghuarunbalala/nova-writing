/** Immutable catalog of validated Tool Group Manifests with deterministic listing. */
import type { ToolGroupManifest } from "./ToolGroupManifest.js";
import { captureToolGroupManifest } from "./ToolGroupManifestLoader.js";
import {
  TOOL_GROUP_CATALOG_FAILURE,
  ToolGroupCatalogError,
} from "./ToolGroupCatalogErrors.js";

const GROUP_ID = /^(?=.{1,64}$)[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export class ToolGroupCatalog {
  readonly #groupsById: ReadonlyMap<string, ToolGroupManifest>;
  readonly #orderedGroups: readonly ToolGroupManifest[];

  constructor(manifests: Iterable<ToolGroupManifest>) {
    const groupsById = new Map<string, ToolGroupManifest>();
    for (const source of manifests) {
      const manifest = captureToolGroupManifest(source);
      if (groupsById.has(manifest.id)) {
        throw new ToolGroupCatalogError(
          TOOL_GROUP_CATALOG_FAILURE.duplicateGroup,
          manifest.id,
        );
      }
      groupsById.set(manifest.id, manifest);
    }
    this.#groupsById = groupsById;
    this.#orderedGroups = Object.freeze(
      [...groupsById.values()].sort(compareGroupIds),
    );
    Object.freeze(this);
  }

  get size(): number {
    return this.#orderedGroups.length;
  }

  has(id: string): boolean {
    return this.#groupsById.has(id);
  }

  get(id: string): ToolGroupManifest | undefined {
    return this.#groupsById.get(id);
  }

  require(id: string): ToolGroupManifest {
    const manifest = this.get(id);
    if (!manifest) {
      throw new ToolGroupCatalogError(
        TOOL_GROUP_CATALOG_FAILURE.unknownGroup,
        GROUP_ID.test(id) ? id : undefined,
      );
    }
    return manifest;
  }

  list(): readonly ToolGroupManifest[] {
    return this.#orderedGroups;
  }
}

function compareGroupIds(
  left: ToolGroupManifest,
  right: ToolGroupManifest,
): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}
