/** Provider-neutral digest Port used to freeze compiled Prompt identities. */

export type PromptDigest = `sha256:${string}`;

export interface PromptDigester {
  readonly algorithm: "sha256";
  digest(content: string): Promise<PromptDigest>;
}

export function capturePromptDigest(value: unknown): PromptDigest {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new TypeError("Prompt digest is invalid");
  }
  return value as PromptDigest;
}
