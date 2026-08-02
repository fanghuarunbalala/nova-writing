/** Merges canonical and Draft Outbox heads into one deterministic delivery order. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  NovelLifecycleOutputPublisher,
  NovelOutboxStore,
} from "../port/index.js";
import { compareNovelOutboxEntries, type NovelOutboxSource } from "./NovelOutbox.js";
import {
  NOVEL_OUTBOX_ENTRY_DISPATCH_STATUS,
  NovelOutboxDispatcher,
  type NovelOutboxEntryDispatchStatus,
} from "./NovelOutboxDispatcher.js";

export interface NovelOutboxDispatchCoordinatorOptions {
  readonly stores: readonly NovelOutboxStore[];
  readonly publisher: NovelLifecycleOutputPublisher;
  readonly logger?: Logger;
}

export interface NovelOutboxSourceDispatchResult {
  readonly source: NovelOutboxSource;
  readonly attemptedCount: number;
  readonly recordedCount: number;
  readonly duplicateCount: number;
  readonly alreadyPublishedCount: number;
}

export interface NovelOutboxCoordinatedDispatchResult {
  readonly attemptedCount: number;
  readonly recordedCount: number;
  readonly duplicateCount: number;
  readonly alreadyPublishedCount: number;
  readonly sourceResults: readonly NovelOutboxSourceDispatchResult[];
}

export class NovelOutboxDispatchCoordinator {
  private readonly dispatchers: readonly NovelOutboxDispatcher[];
  private readonly sources: readonly NovelOutboxSource[];
  private readonly logger: Logger;

  constructor(options: NovelOutboxDispatchCoordinatorOptions) {
    assertUniqueSources(options.stores);
    this.sources = Object.freeze(options.stores.map((store) => store.source));
    this.dispatchers = Object.freeze(
      options.stores.map(
        (store) =>
          new NovelOutboxDispatcher({
            store,
            publisher: options.publisher,
            pageSize: 1,
            logger: options.logger,
          }),
      ),
    );
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_outbox_dispatch_coordinator",
      sourceCount: options.stores.length,
    });
  }

  async dispatchPending(): Promise<NovelOutboxCoordinatedDispatchResult> {
    const counters = this.sources.map((source) => ({
      source,
      attemptedCount: 0,
      recordedCount: 0,
      duplicateCount: 0,
      alreadyPublishedCount: 0,
    }));
    this.logger.debug("novel_outbox_dispatch_coordination.started");

    while (true) {
      const heads = await Promise.all(
        this.dispatchers.map(async (dispatcher, index) => ({
          dispatcher,
          index,
          entry: await dispatcher.readNextPending(),
        })),
      );
      const selected = heads
        .filter((value) => value.entry !== undefined)
        .sort((left, right) =>
          compareNovelOutboxEntries(left.entry!, right.entry!),
        )[0];
      if (selected === undefined) break;
      const status = await selected.dispatcher.dispatchEntry(selected.entry!);
      addStatus(counters[selected.index], status);
    }

    const sourceResults = Object.freeze(
      counters.map((value) => Object.freeze({ ...value })),
    );
    const result = Object.freeze({
      attemptedCount: sum(sourceResults, "attemptedCount"),
      recordedCount: sum(sourceResults, "recordedCount"),
      duplicateCount: sum(sourceResults, "duplicateCount"),
      alreadyPublishedCount: sum(sourceResults, "alreadyPublishedCount"),
      sourceResults,
    });
    this.logger.info("novel_outbox_dispatch_coordination.completed", {
      attemptedCount: result.attemptedCount,
      recordedCount: result.recordedCount,
      duplicateCount: result.duplicateCount,
      alreadyPublishedCount: result.alreadyPublishedCount,
    });
    return result;
  }
}

function addStatus(
  counter: {
    attemptedCount: number;
    recordedCount: number;
    duplicateCount: number;
    alreadyPublishedCount: number;
  },
  status: NovelOutboxEntryDispatchStatus,
): void {
  if (status === NOVEL_OUTBOX_ENTRY_DISPATCH_STATUS.alreadyPublished) {
    counter.alreadyPublishedCount += 1;
    return;
  }
  counter.attemptedCount += 1;
  if (status === NOVEL_OUTBOX_ENTRY_DISPATCH_STATUS.recorded) {
    counter.recordedCount += 1;
  } else {
    counter.duplicateCount += 1;
  }
}

function assertUniqueSources(stores: readonly NovelOutboxStore[]): void {
  const keys = stores.map((store) => sourceKey(store.source));
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("Novel Outbox Coordinator sources must be unique");
  }
}

function sourceKey(source: NovelOutboxSource): string {
  return source.kind === "canonical"
    ? source.kind
    : `${source.kind}:${source.draftSessionId}`;
}

function sum(
  results: readonly NovelOutboxSourceDispatchResult[],
  field: "attemptedCount" | "recordedCount" | "duplicateCount" | "alreadyPublishedCount",
): number {
  return results.reduce((total, result) => total + result[field], 0);
}
