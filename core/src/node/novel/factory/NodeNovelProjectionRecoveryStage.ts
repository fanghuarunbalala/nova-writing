/** Composes one explicit-scope Node SQLite Projection recovery stage. */
import {
  NovelProjectionRecoveryService,
  captureNovelId,
  captureNovelReadScope,
  type EntityProfileReadinessPolicy,
  type NovelClock,
  type NovelId,
  type NovelReadScope,
  type NovelRecoveryStage,
} from "../../../novel/index.js";
import type { Logger } from "../../../observability/index.js";
import {
  SqliteNovelProjectionSourceReader,
  SqliteNovelProjectionStore,
} from "../sqlite/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";

export interface NodeNovelProjectionRecoveryStageOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly scope: NovelReadScope;
  readonly clock: NovelClock;
  readonly readinessPolicy: EntityProfileReadinessPolicy;
  readonly logger?: Logger;
}

export function createNodeNovelProjectionRecoveryStage(
  options: NodeNovelProjectionRecoveryStageOptions,
): NovelRecoveryStage {
  const novelId = captureNovelId(options.novelId);
  const scope = captureNovelReadScope(options.scope);
  return new NovelProjectionRecoveryService({
    sourceReader: new SqliteNovelProjectionSourceReader({
      location: options.location,
      novelId,
      scope,
      logger: options.logger,
    }),
    store: new SqliteNovelProjectionStore({
      location: options.location,
      novelId,
      scope,
      clock: options.clock,
      logger: options.logger,
    }),
    readinessPolicy: options.readinessPolicy,
    logger: options.logger,
  });
}
