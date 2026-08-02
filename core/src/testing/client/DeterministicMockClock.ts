/** Controllable monotonic clock used by deterministic client protocol fixtures. */
export interface MockNovelHostClock {
  now(): string;
}

export interface DeterministicMockClockOptions {
  readonly start?: string;
  readonly stepMilliseconds?: number;
}

export class DeterministicMockClock implements MockNovelHostClock {
  private currentMilliseconds: number;
  private readonly stepMilliseconds: number;

  constructor(options: DeterministicMockClockOptions = {}) {
    const start = options.start ?? "2026-08-02T00:00:00.000Z";
    const parsed = Date.parse(start);
    if (!Number.isFinite(parsed)) {
      throw new TypeError("Deterministic Mock clock start must be an ISO timestamp");
    }
    const stepMilliseconds = options.stepMilliseconds ?? 1;
    if (!Number.isSafeInteger(stepMilliseconds) || stepMilliseconds < 1) {
      throw new TypeError("Deterministic Mock clock step must be a positive integer");
    }
    this.currentMilliseconds = parsed;
    this.stepMilliseconds = stepMilliseconds;
  }

  now(): string {
    const current = new Date(this.currentMilliseconds).toISOString();
    this.currentMilliseconds += this.stepMilliseconds;
    return current;
  }

  peek(): string {
    return new Date(this.currentMilliseconds).toISOString();
  }

  advanceBy(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new TypeError("Deterministic Mock clock advance must be a non-negative integer");
    }
    this.currentMilliseconds += milliseconds;
  }
}
