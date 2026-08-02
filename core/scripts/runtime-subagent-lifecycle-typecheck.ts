import {
  DefaultSubagentLifecycleCoordinator,
  type DefaultSubagentLifecycleCoordinatorOptions,
  type SubagentLifecycleCoordinator,
} from "../src/index.js";

declare const options: DefaultSubagentLifecycleCoordinatorOptions;
const coordinator: SubagentLifecycleCoordinator =
  new DefaultSubagentLifecycleCoordinator(options);

void coordinator;
