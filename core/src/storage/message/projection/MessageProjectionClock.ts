/** Injectable wall clock for persistence metadata and deterministic tests. */
export interface MessageProjectionClock {
  now(): string;
}

export class SystemMessageProjectionClock implements MessageProjectionClock {
  now(): string {
    return new Date().toISOString();
  }
}
