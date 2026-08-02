/** Typed synchronous Operation Handler registry for transaction-safe execution. */
import {
  NovelOperationHandlerNotFoundError,
  NovelOperationRegistrationError,
  NovelOperationSynchronousHandlerError,
} from "../error/index.js";
import {
  captureNovelOperationVersion,
  type NovelOperationVersion,
} from "../version/index.js";
import {
  captureNovelOperation,
  captureOperationType,
  type NovelOperation,
} from "./NovelOperation.js";

export interface NovelOperationHandler<
  TContext,
  TOperation extends NovelOperation = NovelOperation,
> {
  readonly operationType: TOperation["type"];
  readonly operationVersion: NovelOperationVersion;
  apply(context: TContext, operation: TOperation): unknown;
}

export class NovelOperationRegistry<TContext> {
  private readonly handlers = new Map<
    string,
    NovelOperationHandler<TContext>
  >();

  register<TOperation extends NovelOperation>(
    handler: NovelOperationHandler<TContext, TOperation>,
  ): void {
    const operationType = captureOperationType(handler.operationType);
    const operationVersion = captureNovelOperationVersion(
      handler.operationVersion,
    );
    const key = operationKey(operationType, operationVersion);
    if (this.handlers.has(key)) {
      throw new NovelOperationRegistrationError(
        operationType,
        operationVersion,
      );
    }
    if (handler.apply.constructor.name === "AsyncFunction") {
      throw new NovelOperationSynchronousHandlerError(
        operationType,
        operationVersion,
      );
    }
    this.handlers.set(key, handler as NovelOperationHandler<TContext>);
  }

  resolve(operation: NovelOperation): NovelOperationHandler<TContext> {
    const captured = captureNovelOperation(operation);
    const handler = this.handlers.get(
      operationKey(captured.type, captured.operationVersion),
    );
    if (handler === undefined) {
      throw new NovelOperationHandlerNotFoundError(
        captured.type,
        captured.operationVersion,
      );
    }
    return handler;
  }
}

export class NovelOperationExecutor<TContext> {
  constructor(private readonly registry: NovelOperationRegistry<TContext>) {}

  async execute(context: TContext, operation: NovelOperation): Promise<void> {
    this.executeSynchronous(context, operation);
  }

  executeSynchronous(context: TContext, operation: NovelOperation): void {
    const captured = captureNovelOperation(operation);
    const result = this.registry.resolve(captured).apply(context, captured);
    if (result !== undefined) {
      throw new NovelOperationSynchronousHandlerError(
        captured.type,
        captured.operationVersion,
      );
    }
  }
}

function operationKey(type: string, version: NovelOperationVersion): string {
  return `${type}@${version}`;
}
