/** Core-owned opaque Run and Turn identity generation. */
export interface RunIdGenerator {
  generate(): string;
}

export interface TurnIdGenerator {
  generate(): string;
}

export class RandomRunIdGenerator implements RunIdGenerator {
  generate(): string {
    return `run_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  }
}

export class RandomTurnIdGenerator implements TurnIdGenerator {
  generate(): string {
    return `turn_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  }
}
