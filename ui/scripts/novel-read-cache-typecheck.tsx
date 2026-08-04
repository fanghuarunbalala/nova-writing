/** Compile-only proof for the canonical Novel read cache in the shared React shell. */
import {
  createNovelReadCache,
  NovelReadCacheProvider,
  useNovelReadCache,
  type NovelReadCache,
} from "../src/index.js";

const cache = createNovelReadCache();
cache.noteRevision("revision");
cache.set("canonical:characters", Object.freeze({ characters: [] }));
void cache.get("canonical:characters");
cache.invalidate("canonical:characters");
cache.clear();

function CacheConsumer() {
  const readCache: NovelReadCache = useNovelReadCache();
  return <>{readCache.getRevision() ?? "none"}</>;
}

const element = (
  <NovelReadCacheProvider>
    <CacheConsumer />
  </NovelReadCacheProvider>
);

void element;
