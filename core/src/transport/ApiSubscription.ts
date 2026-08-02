/** Transport-neutral asynchronous subscription used by Electron and Web adapters. */
import type { ApiEventFrame } from "./ApiEventFrame.js";

export interface ApiSubscription extends AsyncIterableIterator<ApiEventFrame> {
  readonly id: string;

  close(): Promise<void>;
}
