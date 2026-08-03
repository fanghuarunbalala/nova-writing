/** Concrete Runtime Todo Tools. */
import { ToolRegistry } from "../../tooling/registry/index.js";
import {
  createTodoWriteTool,
  type CreateTodoWriteToolOptions,
} from "./TodoWrite.js";

export * from "./TodoWrite.js";

export function createTodoToolRegistry(
  options: CreateTodoWriteToolOptions,
): ToolRegistry {
  return new ToolRegistry([createTodoWriteTool(options)]);
}
