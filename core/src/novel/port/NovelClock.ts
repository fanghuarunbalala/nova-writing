/** Supplies canonical UTC timestamps without coupling Novel services to timers. */
import {
  captureNovelTimestamp,
  type NovelTimestamp,
} from "../version/index.js";

export interface NovelClock {
  now(): NovelTimestamp;
}

export class SystemNovelClock implements NovelClock {
  now(): NovelTimestamp {
    return captureNovelTimestamp(new Date().toISOString());
  }
}
