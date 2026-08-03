/** Validates durable repair records and resolves Anchors through Redirect chains. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import type { ManuscriptBlockId } from "../../identity/index.js";
import {
  captureManuscriptAnchor,
  type ManuscriptAnchor,
} from "./ManuscriptAnchor.js";
import type { ManuscriptCatalog } from "./ManuscriptCatalog.js";
import {
  MANUSCRIPT_ANCHOR_BOUNDARY,
} from "./ManuscriptAnchor.js";
import {
  MANUSCRIPT_REDIRECT_REASON,
  MANUSCRIPT_REPAIR_REVIEW,
  MANUSCRIPT_TOMBSTONE_REASON,
  captureManuscriptAnchorRedirect,
  captureManuscriptBlockTombstone,
  manuscriptAnchorKey,
  type ManuscriptAnchorRedirect,
  type ManuscriptBlockTombstone,
} from "./ManuscriptRepair.js";

export interface ManuscriptRepairCatalogSnapshot {
  readonly tombstones: readonly ManuscriptBlockTombstone[];
  readonly redirects: readonly ManuscriptAnchorRedirect[];
}

export type ManuscriptAnchorResolution =
  | {
      readonly status: "active";
      readonly source: ManuscriptAnchor;
      readonly anchor: ManuscriptAnchor;
      readonly reviewRequired: false;
      readonly redirectCount: 0;
    }
  | {
      readonly status: "redirected";
      readonly source: ManuscriptAnchor;
      readonly anchor: ManuscriptAnchor;
      readonly reviewRequired: boolean;
      readonly redirectCount: number;
    }
  | {
      readonly status: "tombstoned";
      readonly source: ManuscriptAnchor;
      readonly tombstone: ManuscriptBlockTombstone;
      readonly reviewRequired: true;
      readonly redirectCount: 0;
    }
  | {
      readonly status: "orphaned";
      readonly source: ManuscriptAnchor;
      readonly reviewRequired: true;
      readonly redirectCount: 0;
    };

const SNAPSHOT_KEYS = new Set(["tombstones", "redirects"]);

export class ManuscriptRepairCatalog {
  private readonly snapshot: ManuscriptRepairCatalogSnapshot;
  private readonly tombstonesByBlockId: ReadonlyMap<
    ManuscriptBlockId,
    ManuscriptBlockTombstone
  >;
  private readonly redirectsBySource: ReadonlyMap<
    string,
    ManuscriptAnchorRedirect
  >;

  constructor(
    value: unknown,
    private readonly manuscript: ManuscriptCatalog,
  ) {
    const captured = captureCatalogInput(value);
    const indexed = indexRepairs(captured, manuscript);
    this.snapshot = Object.freeze({
      tombstones: Object.freeze(
        [...indexed.tombstonesByBlockId.values()].sort((left, right) =>
          left.blockId.localeCompare(right.blockId)
        ),
      ),
      redirects: Object.freeze(
        [...indexed.redirectsBySource.values()].sort((left, right) =>
          manuscriptAnchorKey(left.source).localeCompare(
            manuscriptAnchorKey(right.source),
          )
        ),
      ),
    });
    this.tombstonesByBlockId = indexed.tombstonesByBlockId;
    this.redirectsBySource = indexed.redirectsBySource;
    for (const redirect of this.snapshot.redirects) {
      assertRedirectTargetResolves(redirect.target, this);
    }
  }

  getSnapshot(): ManuscriptRepairCatalogSnapshot {
    return this.snapshot;
  }

  getManuscriptId() {
    return this.manuscript.getSnapshot().manuscript.id;
  }

  getTombstone(
    blockId: ManuscriptBlockId,
  ): ManuscriptBlockTombstone | undefined {
    return this.tombstonesByBlockId.get(blockId);
  }

  getRedirect(source: ManuscriptAnchor): ManuscriptAnchorRedirect | undefined {
    return this.redirectsBySource.get(manuscriptAnchorKey(source));
  }

  resolveAnchor(value: unknown): ManuscriptAnchorResolution {
    const source = captureManuscriptAnchor(value);
    let current = source;
    let reviewRequired = false;
    let redirectCount = 0;
    const visited = new Set<string>();
    while (true) {
      const key = manuscriptAnchorKey(current);
      if (visited.has(key)) throw invalidRepair();
      visited.add(key);
      const redirect = this.redirectsBySource.get(key);
      if (redirect === undefined) break;
      reviewRequired ||= redirect.review === MANUSCRIPT_REPAIR_REVIEW.required;
      redirectCount += 1;
      current = redirect.target;
    }
    if (this.manuscript.getBlock(current.blockId) !== undefined) {
      return redirectCount === 0
        ? Object.freeze({
            status: "active",
            source,
            anchor: current,
            reviewRequired: false,
            redirectCount: 0,
          })
        : Object.freeze({
            status: "redirected",
            source,
            anchor: current,
            reviewRequired,
            redirectCount,
          });
    }
    const tombstone = this.tombstonesByBlockId.get(current.blockId);
    return tombstone === undefined
      ? Object.freeze({
          status: "orphaned",
          source,
          reviewRequired: true,
          redirectCount: 0,
        })
      : Object.freeze({
          status: "tombstoned",
          source,
          tombstone,
          reviewRequired: true,
          redirectCount: 0,
        });
  }
}

function captureCatalogInput(value: unknown): ManuscriptRepairCatalogSnapshot {
  const candidate = captureSnapshotRecord(value);
  captureDenseArray(candidate.tombstones);
  captureDenseArray(candidate.redirects);
  return Object.freeze({
    tombstones: Object.freeze(
      candidate.tombstones.map(captureManuscriptBlockTombstone),
    ),
    redirects: Object.freeze(
      candidate.redirects.map(captureManuscriptAnchorRedirect),
    ),
  });
}

function indexRepairs(
  snapshot: ManuscriptRepairCatalogSnapshot,
  manuscript: ManuscriptCatalog,
) {
  const manuscriptId = manuscript.getSnapshot().manuscript.id;
  const tombstonesByBlockId = new Map<
    ManuscriptBlockId,
    ManuscriptBlockTombstone
  >();
  for (const tombstone of snapshot.tombstones) {
    if (
      tombstone.manuscriptId !== manuscriptId ||
      manuscript.getBlock(tombstone.blockId) !== undefined ||
      tombstonesByBlockId.has(tombstone.blockId)
    ) {
      throw invalidRepair();
    }
    tombstonesByBlockId.set(tombstone.blockId, tombstone);
  }
  for (const tombstone of tombstonesByBlockId.values()) {
    if (
      tombstone.reason === MANUSCRIPT_TOMBSTONE_REASON.merged &&
      !isKnownBlock(tombstone.replacementBlockId, manuscript, tombstonesByBlockId)
    ) {
      throw invalidRepair();
    }
  }

  const redirectsBySource = new Map<string, ManuscriptAnchorRedirect>();
  for (const redirect of snapshot.redirects) {
    const sourceKey = manuscriptAnchorKey(redirect.source);
    if (
      redirectsBySource.has(sourceKey) ||
      !isKnownBlock(redirect.source.blockId, manuscript, tombstonesByBlockId) ||
      !isKnownBlock(redirect.target.blockId, manuscript, tombstonesByBlockId)
    ) {
      throw invalidRepair();
    }
    assertRedirectKind(redirect, manuscript, tombstonesByBlockId);
    redirectsBySource.set(sourceKey, redirect);
  }
  return { tombstonesByBlockId, redirectsBySource };
}

function assertRedirectKind(
  redirect: ManuscriptAnchorRedirect,
  manuscript: ManuscriptCatalog,
  tombstones: ReadonlyMap<ManuscriptBlockId, ManuscriptBlockTombstone>,
): void {
  const sourceTombstone = tombstones.get(redirect.source.blockId);
  switch (redirect.reason) {
    case MANUSCRIPT_REDIRECT_REASON.split:
      if (
        manuscript.getBlock(redirect.source.blockId) === undefined ||
        redirect.source.boundary !== MANUSCRIPT_ANCHOR_BOUNDARY.after ||
        redirect.target.boundary !== MANUSCRIPT_ANCHOR_BOUNDARY.after
      ) {
        throw invalidRepair();
      }
      break;
    case MANUSCRIPT_REDIRECT_REASON.merge:
      if (
        sourceTombstone?.reason !== MANUSCRIPT_TOMBSTONE_REASON.merged ||
        sourceTombstone.replacementBlockId !== redirect.target.blockId ||
        redirect.source.boundary !== redirect.target.boundary
      ) {
        throw invalidRepair();
      }
      break;
    case MANUSCRIPT_REDIRECT_REASON.manualRepair:
      if (sourceTombstone === undefined) throw invalidRepair();
      break;
  }
}

function assertRedirectTargetResolves(
  target: ManuscriptAnchor,
  catalog: ManuscriptRepairCatalog,
): void {
  const resolution = catalog.resolveAnchor(target);
  if (
    resolution.status === "tombstoned" ||
    resolution.status === "orphaned"
  ) {
    throw invalidRepair();
  }
}

function isKnownBlock(
  blockId: ManuscriptBlockId | undefined,
  manuscript: ManuscriptCatalog,
  tombstones: ReadonlyMap<ManuscriptBlockId, ManuscriptBlockTombstone>,
): boolean {
  return blockId !== undefined &&
    (manuscript.getBlock(blockId) !== undefined || tombstones.has(blockId));
}

function captureSnapshotRecord(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0 ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (descriptor) => !("value" in descriptor) || !descriptor.enumerable,
    ) ||
    Object.keys(value).some((key) => !SNAPSHOT_KEYS.has(key))
  ) {
    throw invalidRepair();
  }
  return value as Record<string, unknown>;
}

function captureDenseArray(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.keys(value).length !== value.length
  ) {
    throw invalidRepair();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidRepair();
    }
  }
}

function invalidRepair(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidManuscriptRepair,
    "manuscriptRepair",
  );
}
