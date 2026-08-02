/** Platform-neutral canonical Novel metadata store boundary. */
import type { NovelCanonicalMetadata } from "../model/index.js";

export interface NovelCanonicalStore {
  getMetadata(): Promise<NovelCanonicalMetadata>;

  close(): Promise<void>;
}
