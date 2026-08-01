import { RuntimeMessageSchemaRegistry } from "./RuntimeMessageSchemaRegistry.js";
import { registerCoreRuntimeMessageSchemas } from "./schema/CoreRuntimeMessageSchemas.js";

export function createCoreRuntimeMessageSchemaRegistry(): RuntimeMessageSchemaRegistry {
  const registry = new RuntimeMessageSchemaRegistry();
  registerCoreRuntimeMessageSchemas(registry);
  return registry;
}

export const coreRuntimeMessageSchemaRegistry = createCoreRuntimeMessageSchemaRegistry();
