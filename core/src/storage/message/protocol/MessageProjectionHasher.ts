/**
 * Platform-neutral SHA-256 capability used by the Message projection protocol.
 * Node, browser, and native adapters may provide different implementations.
 */
export interface MessageProjectionHasher {
  readonly algorithm: "sha256";

  digest(canonicalContent: string): string;
}
