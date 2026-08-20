/**
 * skill 元工具（runtime.skills 组）：按名读取已装载技能的完整说明（SKILL.md 正文）。
 * 渐进式披露第二层——第一层索引（name + description）经本工具 promptDetail.guidance
 * 由 tool.guidance 动态段渲染进 system prompt，正文仅在模型调用本工具时进入对话。
 * 纯本地只读：requireApproval 缺省 false（与 runtime.files 读同档）。
 */
import type { ToolDef } from "../ToolDef.js";
import type { ToolCall } from "../../provider/types.js";
import { ToolError } from "../errors.js";
import { renderSkillIndex, type SkillRegistry } from "../../skill/SkillRegistry.js";

/** 解析 tool args JSON */
function parseArgs(call: ToolCall): { name: string } {
  try {
    const args = JSON.parse(call.args) as { name?: unknown };
    if (typeof args.name !== "string" || args.name.length === 0) {
      throw new Error("name 必须为非空字符串");
    }
    return { name: args.name };
  } catch (err) {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name, cause: err },
      `无效的 skill 参数: ${call.args}`,
    );
  }
}

/** skill 工具描述（何时用 / 怎么用） */
const SKILL_TOOL_DESCRIPTION = [
  "读取一项已装载技能的完整说明（方法论、规范、流程），返回其 SKILL.md 正文。",
  "",
  "## 何时使用",
  "1. 系统提示「技能（Skills）」清单中的技能与当前任务相关时——动笔前先读取",
  "2. 用户点名要求使用某项技能时",
  "",
  "## 使用方式",
  "传入清单中的技能名（name），返回该技能的完整 Markdown 说明；阅读后按说明开展工作。",
  "不在清单中的技能不存在，不要猜测或编造技能名。",
].join("\n");

/**
 * 创建 skill 工具（handler 闭包技能注册表）。
 * @param registry 技能注册表（缺省 = 未装配降级：无索引、调用回不可用文本，对齐 runtime.ask 先例）
 * @returns skill 工具定义
 */
export function createSkillTool(registry?: SkillRegistry): ToolDef {
  const effective = registry?.effective() ?? [];
  return {
    name: "skill",
    version: "1.0.0",
    description: SKILL_TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "技能名（见系统提示技能清单）" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    // 索引随注册表装配期固定（会话期技能面不变）：空清单渲染空串 → tool.guidance 段省略
    ...(registry !== undefined ? { promptDetail: { guidance: renderSkillIndex(effective) } } : {}),
    handler: {
      execute: async (call) => {
        const { name } = parseArgs(call);
        if (registry === undefined) {
          return "技能系统未装配：当前会话没有配置技能目录。";
        }
        const record = registry.get(name);
        if (record === undefined) {
          throw new ToolError(
            { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
            `技能不存在: ${name}（可用技能见系统提示技能清单）`,
          );
        }
        if (!registry.isEffective(name)) {
          throw new ToolError(
            { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
            `技能已被禁用: ${name}（如需启用请在设置 → 技能中打开）`,
          );
        }
        const body = await registry.readBody(name);
        if (body === undefined) {
          throw new ToolError(
            { code: "TOOL_HANDLER_FAILED", toolName: call.name },
            `技能文件读取失败: ${record.file}`,
          );
        }
        return body;
      },
    },
  };
}
