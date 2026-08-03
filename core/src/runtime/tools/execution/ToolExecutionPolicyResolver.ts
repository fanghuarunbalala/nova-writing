/** Immutable exact Tool identity to execution-policy resolver. */
import type { RegisteredTool } from "../../../tooling/protocol/RegisteredTool.js";
import { isToolName } from "../../../tooling/protocol/ToolName.js";
import type { ToolExecutionPolicy } from "./ToolExecutionContracts.js";
import { ToolError } from "./ToolExecutionError.js";
import { captureToolExecutionPolicy } from "./ToolExecutionProtocolValidator.js";

export interface ToolExecutionPolicyBinding {
  readonly toolName: string;
  readonly toolVersion: string;
  readonly policy: ToolExecutionPolicy;
}

export interface ToolExecutionPolicyResolver {
  resolve(tool: RegisteredTool): ToolExecutionPolicy;
}

export class StaticToolExecutionPolicyResolver
  implements ToolExecutionPolicyResolver
{
  readonly #policies: ReadonlyMap<string, ToolExecutionPolicy>;

  constructor(bindings: Iterable<ToolExecutionPolicyBinding>) {
    const policies = new Map<string, ToolExecutionPolicy>();
    for (const binding of bindings) {
      const key = captureBindingKey(binding);
      if (policies.has(key)) {
        throw new ToolError({
          code: "TOOL_EXECUTION_POLICY_DUPLICATE",
          category: "internal",
          sideEffectStatus: "none",
          toolName: safeToolName(binding?.toolName),
          toolVersion: safeToolVersion(binding?.toolVersion),
        });
      }
      policies.set(key, captureToolExecutionPolicy(binding.policy));
    }
    this.#policies = policies;
    Object.freeze(this);
  }

  resolve(tool: RegisteredTool): ToolExecutionPolicy {
    const policy = this.#policies.get(
      `${tool.descriptor.name}@${tool.descriptor.version}`,
    );
    if (!policy) {
      throw new ToolError({
        code: "TOOL_EXECUTION_POLICY_MISSING",
        category: "internal",
        sideEffectStatus: "none",
        toolName: tool.descriptor.name,
        toolVersion: tool.descriptor.version,
      });
    }
    return policy;
  }
}

function captureBindingKey(binding: ToolExecutionPolicyBinding): string {
  const toolName = safeToolName(binding?.toolName);
  const toolVersion = safeToolVersion(binding?.toolVersion);
  if (!toolName || !toolVersion) {
    throw new ToolError({
      code: "TOOL_EXECUTION_POLICY_INVALID",
      category: "internal",
      sideEffectStatus: "none",
      ...(toolName ? { toolName } : {}),
      ...(toolVersion ? { toolVersion } : {}),
    });
  }
  return `${toolName}@${toolVersion}`;
}

function safeToolName(value: unknown): string | undefined {
  return isToolName(value) ? value : undefined;
}

function safeToolVersion(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    ? value
    : undefined;
}
