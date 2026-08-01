export type RuntimeKind = "agent";

export type RuntimeConfig = {
  kind: RuntimeKind;
};

export type Runtime = {
  kind: RuntimeKind;
  describe(): string;
};

export function createRuntime(config: RuntimeConfig): Runtime {
  return {
    kind: config.kind,
    describe() {
      return "runtime adapter";
    },
  };
}

export * from "./message/index.js";
