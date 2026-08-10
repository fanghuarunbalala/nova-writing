/**
 * core.runtime.protocol 通用段：system-reminder 说明（跨域共享，对齐 CC）。
 * Generic section: system-reminder guidance (shared across domains, aligned with CC).
 */
import { PromptSection } from "../../section/PromptSection.js";

export class CoreRuntimeProtocolPromptSection extends PromptSection {
  constructor() {
    super({
      id: "core.runtime.protocol",
      version: "1.0.0",
      label: "Core Runtime Protocol",
    });
  }

  render(): string {
    return [
      "工具结果与用户消息可能包含 <system-reminder> 标签：它们由 Runtime 自动注入，承载有用的信息与提醒，与所在的具体工具结果或用户消息没有直接关系——把每条提醒当作当前权威状态信号，而非顺序叙事。",
    ].join("\n");
  }
}
