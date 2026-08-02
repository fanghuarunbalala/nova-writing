/** Transport-neutral asynchronous Runtime IPC Frame connection. */
import type { RuntimeIpcFrame } from "../protocol/index.js";

export interface RuntimeIpcConnection extends AsyncIterableIterator<RuntimeIpcFrame> {
  send(frame: RuntimeIpcFrame): Promise<void>;

  close(): Promise<void>;
}
