import { EventSchemaRegistry } from "./protocol/EventSchemaRegistry.js";
import { registerCoreInputEventSchemas } from "./input/schema/CoreInputEventSchemas.js";

export function createCoreEventSchemaRegistry(): EventSchemaRegistry {
  const registry = new EventSchemaRegistry();
  registerCoreInputEventSchemas(registry);
  return registry;
}

export const coreEventSchemaRegistry = createCoreEventSchemaRegistry();
