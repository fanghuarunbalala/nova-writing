import { EventSchemaRegistry } from "./protocol/EventSchemaRegistry.js";
import { registerCoreInputEventSchemas } from "./input/schema/CoreInputEventSchemas.js";
import { registerCoreOutputEventSchemas } from "./output/schema/CoreOutputEventSchemas.js";

export function createCoreEventSchemaRegistry(): EventSchemaRegistry {
  const registry = new EventSchemaRegistry();
  registerCoreInputEventSchemas(registry);
  registerCoreOutputEventSchemas(registry);
  return registry;
}

export const coreEventSchemaRegistry = createCoreEventSchemaRegistry();
