/**
 * skill.index 动态段：渲染技能索引（渐进式披露第一层）——仅 name + description
 * 单行清单 + 使用指引，正文不进 prompt（第二层经 skill 工具按需读取）。
 * 数据来源 DynamicPromptSectionInput.skills（宿主装配期从 SkillRegistry.effective()
 * 派生一次，会话期静态）；缺失或空清单返回空串（整段省略）。
 * 文案复用 renderSkillIndex（与 tool.guidance 搭车时代保持一致）。
 */
import type { PromptSection } from "../prompt/PromptSection.js";
import { renderSkillIndex } from "./SkillRegistry.js";

/** 技能索引段（skill.index） */
export const skillIndexSection: PromptSection = {
  kind: "dynamic",
  id: "skill.index",
  version: "1.0.0",
  label: "Skill Index",
  renderDynamic: (input) => {
    const skills = input.skills;
    if (skills === undefined || skills.entries.length === 0) return "";
    return renderSkillIndex(skills.entries);
  },
};
