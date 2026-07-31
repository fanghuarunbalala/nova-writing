export type PersistedEventSnapshot<TEvent extends object> = TEvent & {
  sequence: number;
  recordedAt: string;
};
