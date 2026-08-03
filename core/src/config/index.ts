export type CoreConfig = {
  runtime: "agent";
  locale: string;
};

export const defaultCoreConfig: CoreConfig = {
  runtime: "agent",
  locale: "zh-CN",
};

export * from "./ApplicationConfiguration.js";
export * from "./ApplicationSettings.js";
export * from "./ConfigurationProtocol.js";
export * from "./ConfigurationStore.js";
export * from "./EffectiveConfigurationResolver.js";
export * from "./ModelConfiguration.js";
export * from "./ModelConfigurationCommand.js";
export * from "./ModelConfigurationCommandService.js";
export * from "./RuntimeProfile.js";
export * from "./ScopedConfiguration.js";
