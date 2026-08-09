/** 一个 nudge 的自包含定义：手写 Policy 类 + Template + 工具组守卫。 */
import type { RuntimePolicy } from "../../policy/index.js";
import type { NudgeTemplate } from "../NudgeTemplateRegistry.js";

export interface NudgeDefinition {
  /** nudgeId（novel.reminder.*），同时作为 templateId。 */
  readonly id: string;
  readonly version: string;
  /** 工具组守卫：必须 ∈ 会话 manifest tools.groupIds，否则装配时跳过。 */
  readonly requiredToolGroup: string;
  /** 完整手写 Policy 类工厂（非数据表，保留全部触发逻辑）。 */
  readonly createPolicy: () => RuntimePolicy;
  /** 域文案模板（与 Policy 同文件 co-located）。 */
  readonly template: NudgeTemplate;
}
