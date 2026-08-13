import type { AgentDefinition } from "../agent/AgentDefinition.js";
import type { AgentCapability } from "../agent/AgentCapability.js";
import type { ToolDef } from "../tool/ToolDef.js";
import type { PromptSection } from "../prompt/PromptSection.js";
import type { ContextNudgePolicy } from "../nudge/ContextNudgePolicy.js";
import type { ContextCompactPolicy } from "../compact/ContextCompactPolicy.js";
import { applyToolPolicy } from "../tool/toolPolicy.js";
import type { Registry } from "./Registry.js";

/** key：`id/type + version` 组合 */
const key = (id: string, version: string): string => `${id}@${version}`;

/** 内存 Registry 实现：5 个 Map 注册/获取，buildCapability 按 agent 关联组装 AgentCapability */
export class InMemoryRegistry implements Registry {
  /** agent 定义（key: type@version） */
  private readonly agents = new Map<string, AgentDefinition>();
  /** 工具定义（key: name@version） */
  private readonly tools = new Map<string, ToolDef>();
  /** 提示分段（key: id@version） */
  private readonly prompts = new Map<string, PromptSection>();
  /** nudge 策略（key: id@version） */
  private readonly nudges = new Map<string, ContextNudgePolicy>();
  /** compact 策略（key: id@version） */
  private readonly compacts = new Map<string, ContextCompactPolicy>();

  /**
   * 注册 agent 定义（key = agentType + agentVersion）
   * @param def agent 定义
   */
  registerAgent(def: AgentDefinition): void {
    this.agents.set(key(def.agentType, def.agentVersion), def);
  }

  /**
   * 获取 agent 定义
   * @param type agent 类型
   * @param version agent 版本
   * @returns agent 定义
   * @throws 未注册时抛出
   */
  getAgent(type: string, version: string): AgentDefinition {
    const def = this.agents.get(key(type, version));
    if (!def) {
      throw new Error(`Agent 未注册: ${type}@${version}`);
    }
    return def;
  }

  /**
   * 注册工具（key = name + version）
   * @param def 工具定义
   */
  registerTool(def: ToolDef): void {
    this.tools.set(key(def.name, def.version), def);
  }

  /**
   * 获取工具
   * @param name 工具名
   * @param version 工具版本
   * @returns 工具定义；未注册返回 undefined
   */
  getTool(name: string, version: string): ToolDef | undefined {
    return this.tools.get(key(name, version));
  }

  /**
   * 注册提示分段（key = id + version）
   * @param section 提示分段
   * @param id 分段 id
   * @param version 版本
   */
  registerPrompt(section: PromptSection, id: string, version: string): void {
    this.prompts.set(key(id, version), section);
  }

  /**
   * 获取提示分段
   * @param id 分段 id
   * @param version 版本
   * @returns 提示分段；未注册返回 undefined
   */
  getPrompt(id: string, version: string): PromptSection | undefined {
    return this.prompts.get(key(id, version));
  }

  /**
   * 注册 nudge 策略（key = id + version）
   * @param policy 提示注入策略
   * @param id 策略 id
   * @param version 版本
   */
  registerNudge(policy: ContextNudgePolicy, id: string, version: string): void {
    this.nudges.set(key(id, version), policy);
  }

  /**
   * 获取 nudge 策略
   * @param id 策略 id
   * @param version 版本
   * @returns 策略；未注册返回 undefined
   */
  getNudge(id: string, version: string): ContextNudgePolicy | undefined {
    return this.nudges.get(key(id, version));
  }

  /**
   * 注册 compact 策略（key = id + version）
   * @param policy 压缩策略
   * @param id 策略 id
   * @param version 版本
   */
  registerCompact(policy: ContextCompactPolicy, id: string, version: string): void {
    this.compacts.set(key(id, version), policy);
  }

  /**
   * 获取 compact 策略
   * @param id 策略 id
   * @param version 版本
   * @returns 策略；未注册返回 undefined
   */
  getCompact(id: string, version: string): ContextCompactPolicy | undefined {
    return this.compacts.get(key(id, version));
  }

  /**
   * 组装统一能力：按 agent 关联的 tools / prompts / 策略 → AgentCapability
   * 关联项 version 与 agent 同 version；未注册的关联项跳过（prompt/nudge/compact）。
   * 工具收集走策略：池 = 注册表中 version === agentVersion 的全部工具（保注册序），
   * 经 applyToolPolicy(def.tools) 过滤；allow/deny 名单项不在池 → 抛
   * TOOL_POLICY_INVALID（对齐旧版 validateKnownTools 抛错，非静默跳过）。
   * 注册约定：工具须以 version === 目标 agent 的 agentVersion 注册，否则不进池。
   * @param agentType agent 类型
   * @param agentVersion agent 版本
   * @returns 组装好的 AgentCapability
   */
  buildCapability(agentType: string, agentVersion: string): AgentCapability {
    const def = this.getAgent(agentType, agentVersion);
    const collect = <T>(ids: string[] | undefined, get: (id: string, version: string) => T | undefined): T[] => {
      const result: T[] = [];
      for (const id of ids ?? []) {
        const item = get(id, agentVersion);
        if (item) result.push(item);
      }
      return result;
    };
    const toolPool = [...this.tools.values()].filter((t) => t.version === agentVersion);
    return {
      systemSections: collect(def.promptIds ?? [], (id, v) => this.getPrompt(id, v)),
      toolDefs: applyToolPolicy(toolPool, def.tools),
      nudgePolicies: collect(def.nudgeIds ?? [], (id, v) => this.getNudge(id, v)),
      compactPolicies: collect(def.compactIds ?? [], (id, v) => this.getCompact(id, v)),
    };
  }
}
