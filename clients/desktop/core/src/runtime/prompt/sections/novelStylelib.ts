/**
 * 风格示例注入段（novel.stylelib，PRD 检索式形态示例 F3）：content 由宿主
 * stylelib provider 检索派生（写作焦点 → 书库强风格段 top-K，焦点指纹缓存）；
 * 快照缺失/空串 = 段省略（默认关：未接线即不渲染，零残留）。
 * 仅 main recipe 引用（Compose 走 <novel-style-guide> spawn seed，不挂本段——避免双重注入）。
 */
import type { PromptSection } from "../PromptSection.js";

export const novelStylelibSection: PromptSection = {
  kind: "dynamic",
  id: "novel.stylelib",
  version: "1.0.0",
  label: "Novel Stylelib Guide",
  renderDynamic: (input) => input.stylelib?.content ?? "",
};
