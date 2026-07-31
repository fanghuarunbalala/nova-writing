export type CoreConfig = {
  runtime: "agent";
  locale: string;
};

export const defaultCoreConfig: CoreConfig = {
  runtime: "agent",
  locale: "zh-CN",
};
