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

export * from "./agent/index.js";
export * from "./context/index.js";
export * from "./execution/index.js";
export * from "./message/index.js";
export * from "./nudge/index.js";
export * from "./policy/index.js";
