export type ProjectVision = {
  name: string;
  belief: string;
};

export const projectVision: ProjectVision = {
  name: "Novel Harness",
  belief: "Turn imagination into serialized web novels.",
};

export * from "./config/index.js";
export * from "./conversation/index.js";
export * from "./event/index.js";
export * from "./observability/index.js";
export * from "./prompt/index.js";
export * from "./runtime/index.js";
export * from "./storage/index.js";
export * from "./tools/index.js";
