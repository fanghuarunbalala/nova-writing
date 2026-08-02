/** Compile-time examples for the provider-neutral Runtime persistence Ports. */
import type {
  OutputEventSnapshot,
  RuntimePersistencePorts,
  RuntimeRecoverySnapshot,
} from "../src/index.js";
import {
  ChildRuntimePersistenceClient,
  ParentRuntimePersistenceHandler,
  type RuntimeChildCompositionFactory,
} from "../src/node/index.js";

declare const parentHandler: ParentRuntimePersistenceHandler;
declare const client: ChildRuntimePersistenceClient;
declare const ports: RuntimePersistencePorts;
declare const snapshot: OutputEventSnapshot;
declare const recovery: RuntimeRecoverySnapshot;
declare const compositionFactory: RuntimeChildCompositionFactory;

void parentHandler;
void client;
void ports.journal.appendOutput("conversation-example", snapshot);
void ports.runtimeState.load("conversation-example");
void recovery.capturedThroughSequence;
void compositionFactory.create;
