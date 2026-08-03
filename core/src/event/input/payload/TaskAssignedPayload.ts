/** Durable Task assignment payload; Parent context is never copied implicitly. */
import type { ArtifactReference } from "../../../storage/artifact/index.js";
import { captureArtifactReference } from "../../../storage/artifact/index.js";
import type { JsonObject } from "../../protocol/JsonValue.js";
import { EventPayload } from "./EventPayload.js";

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MAX_PROMPT_BYTES = 16 * 1024;
const MAX_ARTIFACT_REFERENCES = 8;
const textEncoder = new TextEncoder();

export interface TaskAssignedPayloadOptions {
  readonly taskId: string;
  readonly requesterConversationId: string;
  readonly prompt: string;
  readonly artifactReferences: readonly ArtifactReference[];
}

export class TaskAssignedPayload extends EventPayload {
  readonly taskId: string;
  readonly requesterConversationId: string;
  readonly prompt: string;
  readonly artifactReferences: readonly ArtifactReference[];

  constructor(options: TaskAssignedPayloadOptions) {
    super();
    this.taskId = requireIdentity(options.taskId);
    this.requesterConversationId = requireIdentity(options.requesterConversationId);
    this.prompt = requirePrompt(options.prompt);
    if (!Array.isArray(options.artifactReferences) ||
        options.artifactReferences.length > MAX_ARTIFACT_REFERENCES) {
      throw new TypeError("Task assignment Artifact references are invalid");
    }
    const artifactReferences = options.artifactReferences.map((reference) =>
      captureArtifactReference(reference),
    );
    const artifactIds = artifactReferences.map((reference) => reference.artifactId);
    if (new Set(artifactIds).size !== artifactIds.length) {
      throw new TypeError("Task assignment Artifact references are duplicated");
    }
    this.artifactReferences = Object.freeze(artifactReferences);
  }

  toObject(): JsonObject {
    return {
      taskId: this.taskId,
      requesterConversationId: this.requesterConversationId,
      prompt: this.prompt,
      artifactReferences: this.artifactReferences.map(artifactToObject),
    };
  }
}

function artifactToObject(reference: ArtifactReference): JsonObject {
  return {
    schemaVersion: reference.schemaVersion,
    artifactId: reference.artifactId,
    conversationId: reference.conversationId,
    contentType: reference.contentType,
    byteLength: reference.byteLength,
    ...(reference.tokenEstimate === undefined
      ? {}
      : { tokenEstimate: reference.tokenEstimate }),
    digest: reference.digest,
    ...(reference.filename === undefined ? {} : { filename: reference.filename }),
  };
}

function requireIdentity(value: unknown): string {
  if (typeof value !== "string" || !IDENTITY.test(value)) {
    throw new TypeError("Task assignment identity is invalid");
  }
  return value;
}

function requirePrompt(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 ||
      textEncoder.encode(value).byteLength > MAX_PROMPT_BYTES) {
    throw new TypeError("Task assignment prompt is invalid");
  }
  return value;
}
