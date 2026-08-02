/** Compile-time examples for the Node-only JSONL Runtime IPC adapter. */
import type { PassThrough } from "node:stream";
import {
  NodeJsonlFrameDecoder,
  NodeJsonlIpcConnection,
} from "../src/node/index.js";
import type { RuntimeIpcConnection } from "../src/index.js";

declare const readable: PassThrough;
declare const writable: PassThrough;

const decoder = new NodeJsonlFrameDecoder();
const frames = decoder.push("{\"frameType\":\"hello\"}");
const connection: RuntimeIpcConnection = new NodeJsonlIpcConnection({
  readable,
  writable,
});

void frames;
void connection;
