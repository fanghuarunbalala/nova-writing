/** Canonical-only read cache for shared Novel query snapshots. */

interface NovelReadCacheEntry {
  readonly revision: string | undefined;
  readonly value: unknown;
}

/**
 * Non-durable UI cache for canonical Novel query results.
 *
 * Entries are captured under the canonical revision observed when the
 * Workspace Overview was loaded. `noteRevision()` prunes entries captured
 * under an older revision so a canonical Commit invalidates read state
 * without the GUI keeping its own durable history.
 */
export class NovelReadCache {
  readonly #entries = new Map<string, NovelReadCacheEntry>();
  #revision: string | undefined;

  getRevision(): string | undefined {
    return this.#revision;
  }

  get<T>(key: string): T | undefined {
    const entry = this.#entries.get(key);
    return entry === undefined ? undefined : (entry.value as T);
  }

  set<T>(key: string, value: T): void {
    this.#entries.set(key, Object.freeze({ revision: this.#revision, value }));
  }

  /** Prunes entries captured under a different canonical revision. */
  noteRevision(revision: string | undefined): void {
    if (revision === this.#revision) return;
    this.#revision = revision;
    for (const [key, entry] of this.#entries) {
      if (entry.revision !== revision) {
        this.#entries.delete(key);
      }
    }
  }

  invalidate(key: string): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
    this.#revision = undefined;
  }
}

export function createNovelReadCache(): NovelReadCache {
  return new NovelReadCache();
}
