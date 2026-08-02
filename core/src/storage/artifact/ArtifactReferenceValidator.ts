/** Validates and freezes logical Artifact references without resolving storage. */
import {
  ARTIFACT_REFERENCE_SCHEMA_VERSION,
  type ArtifactReference,
} from "./ArtifactReference.js";
import {
  ARTIFACT_REFERENCE_VALIDATION_FAILURE,
  ArtifactReferenceValidationError,
} from "./ArtifactReferenceErrors.js";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

export function captureArtifactReference(value: unknown): ArtifactReference {
  const record = asPlainRecord(value);
  const artifactId = captureLogicalId(record?.artifactId);
  const conversationId = captureNonBlank(record?.conversationId);
  try {
    if (!record || !artifactId || !conversationId) throw new Error();
    if (record.schemaVersion !== ARTIFACT_REFERENCE_SCHEMA_VERSION) {
      throw new Error();
    }
    const digest = requireNonBlank(record.digest);
    if (!SHA256_DIGEST.test(digest)) throw new Error();
    const captured: ArtifactReference = {
      schemaVersion: ARTIFACT_REFERENCE_SCHEMA_VERSION,
      artifactId,
      conversationId,
      contentType: requireNonBlank(record.contentType),
      byteLength: requireNonNegativeInteger(record.byteLength),
      ...(record.tokenEstimate === undefined
        ? {}
        : { tokenEstimate: requireNonNegativeInteger(record.tokenEstimate) }),
      digest,
      ...(record.filename === undefined
        ? {}
        : { filename: requireFilename(record.filename) }),
    };
    return Object.freeze(captured);
  } catch {
    throw new ArtifactReferenceValidationError(
      ARTIFACT_REFERENCE_VALIDATION_FAILURE.invalidReference,
      artifactId,
      conversationId,
    );
  }
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined;
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function requireNonBlank(value: unknown): string {
  const captured = captureNonBlank(value);
  if (!captured) throw new Error();
  return captured;
}

function captureLogicalId(value: unknown): string | undefined {
  const captured = captureNonBlank(value);
  if (
    !captured ||
    captured.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(captured)
  ) {
    return undefined;
  }
  return captured;
}

function requireFilename(value: unknown): string {
  const captured = requireNonBlank(value);
  if (
    captured === "." ||
    captured === ".." ||
    captured.length > 255 ||
    /[\\/:\0]/.test(captured)
  ) {
    throw new Error();
  }
  return captured;
}

function requireNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error();
  }
  return value;
}
