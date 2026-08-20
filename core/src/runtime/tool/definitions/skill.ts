/**
 * skill 元工具（runtime.skills 组）：读取已装载技能的内容——SKILL.md 正文（渐进式
 * 披露第二层）或技能内捆绑资源文件（references/scripts 等，技能级只读小沙盒）。
 * 第一层索引（name + description）由 skill.index 动态段渲染进 system prompt
 * （数据经 LoopContext skillsIndex 快照注入，非本工具）。
 * 纯本地只读：requireApproval 缺省 false（与 runtime.files 读同档）。
 */
import type { ToolDef } from "../ToolDef.js";
import type { ToolCall } from "../../provider/types.js";
import { ToolError } from "../errors.js";
import type { SkillRegistry } from "../../skill/SkillRegistry.js";

/** 解析 tool args JSON（path 可选） */
function parseArgs(call: ToolCall): { name: string; path?: string } {
  try {
    const args = JSON.parse(call.args) as { name?: unknown; path?: unknown };
    if (typeof args.name !== "string" || args.name.length === 0) {
      throw new Error("name 必须为非空字符串");
    }
    if (args.path !== undefined && typeof args.path !== "string") {
      throw new Error("path 必须为字符串");
    }
    return {
      name: args.name,
      ...(args.path !== undefined && typeof args.path === "string" ? { path: args.path } : {}),
    };
  } catch (err) {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name, cause: err },
      `无效的 skill 参数: ${call.args}`,
    );
  }
}

/** skill 工具描述（何时用 / 怎么用） */
const SKILL_TOOL_DESCRIPTION = [
  "读取一项已装载技能的完整说明（方法论、规范、流程），返回其 SKILL.md 正文；",
  "也可传入 path（技能内相对路径，如 references/schemas.md）读取该技能捆绑的参考文件与脚本说明。",
  "",
  "## 何时使用",
  "1. 系统提示「技能（Skills）」清单中的技能与当前任务相关时——动笔前先读取",
  "2. 用户点名要求使用某项技能时",
  "3. 技能正文指引查阅其捆绑文件（references/ 等）时——用 path 按需读取",
  "",
  "## 使用方式",
  "传入清单中的技能名（name），返回该技能的完整 Markdown 说明；阅读后按说明开展工作。",
  "技能引用的捆绑文件经可选参数 path 读取（技能内相对路径）。",
  "不在清单中的技能不存在，不要猜测或编造技能名。",
].join("\n");

/**
 * 创建 skill 工具（handler 闭包技能注册表）。
 * @param registry 技能注册表（缺省 = 未装配降级：调用回不可用文本，对齐 runtime.ask 先例）
 * @returns skill 工具定义
 */
export function createSkillTool(registry?: SkillRegistry): ToolDef {
  return {
    name: "skill",
    version: "1.1.0",
    description: SKILL_TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "技能名（见系统提示技能清单）" },
        path: {
          type: "string",
          description: "技能内相对路径（可选；缺省读 SKILL.md 正文，如 references/schemas.md 读捆绑参考文件）",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    handler: {
      execute: async (call) => {
        const { name, path } = parseArgs(call);
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
            `技能已被禁用: ${name}（如需启用请在设置 → Skill 中打开）`,
          );
        }
        if (path !== undefined) {
          let bundled: string | undefined;
          try {
            bundled = await registry.readBundledFile(record, path);
          } catch (err) {
            throw new ToolError(
              { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name, cause: err },
              err instanceof Error ? err.message : `读取技能捆绑文件失败: ${path}`,
            );
          }
          if (bundled === undefined) {
            throw new ToolError(
              { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
              `技能内文件不存在: ${name}/${path}`,
            );
          }
          return bundled;
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
