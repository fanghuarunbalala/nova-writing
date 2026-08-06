/** Provider-neutral digest Port used to freeze compiled Prompt identities. */

export type PromptDigest = `sha256:${string}`;

/** 组装层依赖的最小 prompt 结构（内容 + digest）。Minimal prompt shape (content + digest) required by the assembly layer. */
export interface PromptBase {
  readonly content: string;
  readonly digest: PromptDigest;
}

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
