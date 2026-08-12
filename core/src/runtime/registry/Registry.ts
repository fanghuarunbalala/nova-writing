import type { AgentDefinition } from "../agent/AgentDefinition.js";
import type { AgentCapability } from "../agent/AgentCapability.js";
import type { ToolDef } from "../tool/ToolDef.js";
import type { PromptSection } from "../prompt/PromptSection.js";
import type { ContextNudgePolicy } from "../nudge/ContextNudgePolicy.js";
import type { ContextCompactPolicy } from "../compact/ContextCompactPolicy.js";

/**
 * 统一注册中心：注册 Agent / Tool / PromptSection / 策略（均按 id/type + version），get 获取，组装 AgentCapability。
 * version 必填：缺省（未指定 / 未注册）报错。
 */
export interface Registry {
  /**
   * 注册 agent 定义（key = agentType + agentVersion）
   * @param def agent 定义（agentVersion 必填，含关联 ids）
   */
  registerAgent(def: AgentDefinition): void;
  /**
   * 获取 agent 定义
   * @param type agent 类型
   * @param version agent 版本（必填）
   * @returns agent 定义；未注册报错
   */
  getAgent(type: string, version: string): AgentDefinition;
  /**
   * 注册工具（key = name + version）
   * @param def 工具定义（version 必填）
   */
  registerTool(def: ToolDef): void;
  /**
   * 获取工具
   * @param name 工具名
   * @param version 工具版本（必填）
   * @returns 工具定义；未注册返回 undefined
   */
  getTool(name: string, version: string): ToolDef | undefined;
  /**
   * 注册提示分段（key = id + version）
   * @param section 提示分段
   * @param id 分段 id
   * @param version 版本（必填）
   */
  registerPrompt(section: PromptSection, id: string, version: string): void;
  /**
   * 获取提示分段
   * @param id 分段 id
   * @param version 版本（必填）
   * @returns 提示分段；未注册返回 undefined
   */
  getPrompt(id: string, version: string): PromptSection | undefined;
  /**
   * 注册 nudge 策略（key = id + version）
   * @param policy 提示注入策略
   * @param id 策略 id
   * @param version 版本（必填）
   */
  registerNudge(policy: ContextNudgePolicy, id: string, version: string): void;
  /**
   * 获取 nudge 策略
   * @param id 策略 id
   * @param version 版本（必填）
   * @returns 策略；未注册返回 undefined
   */
  getNudge(id: string, version: string): ContextNudgePolicy | undefined;
  /**
   * 注册 compact 策略（key = id + version）
   * @param policy 压缩策略
   * @param id 策略 id
   * @param version 版本（必填）
   */
  registerCompact(policy: ContextCompactPolicy, id: string, version: string): void;
  /**
   * 获取 compact 策略
   * @param id 策略 id
   * @param version 版本（必填）
   * @returns 策略；未注册返回 undefined
   */
  getCompact(id: string, version: string): ContextCompactPolicy | undefined;
  /**
   * 组装统一能力：按 agent 关联的 tools / prompts / 策略 → AgentCapability
   * @param agentType agent 类型
   * @param agentVersion agent 版本（必填）
   * @returns 组装好的 AgentCapability
   */
  buildCapability(agentType: string, agentVersion: string): AgentCapability;
}
