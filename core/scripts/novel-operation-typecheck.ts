import {
  captureNovelEntityVersion,
  captureNovelOperationId,
  captureNovelOperationVersion,
  type NovelOperation,
  type NovelSchemaVersion,
} from "../src/index.js";

interface RenamePayload {
  readonly characterId: string;
  readonly name: string;
  readonly [key: string]: string;
}

const operation: NovelOperation<"character.rename", RenamePayload> = {
  operationId: captureNovelOperationId("operation_typecheck"),
  operationVersion: captureNovelOperationVersion(1),
  type: "character.rename",
  expected: [
    {
      kind: "entity-version",
      entityType: "character",
      entityId: "character_main",
      expectedEntityVersion: captureNovelEntityVersion(1),
    },
  ],
  payload: { characterId: "character_main", name: "New Name" },
};

void operation;

declare const schemaVersion: NovelSchemaVersion;
// @ts-expect-error Operation and schema versions are intentionally distinct.
const invalidOperationVersion = schemaVersion satisfies typeof operation.operationVersion;
void invalidOperationVersion;
