/**
 * Novel Agent 工具组：5 组 manifest（展示层）+ 组工厂解析器（manifest → ToolDef[]）。
 * Novel Agent tool groups: 5 group manifests (display layer) plus a group
 * factory resolver (manifest → ToolDef[]).
 *
 * 组声明与工具工厂分离：manifest 是配置展示层，工厂按 manifest.tools 名称
 * 解析实际工具定义（缺工具报错）。
 * 六域三件套（19 件）已收敛为 novel.entities 组的 4 件 kind 分发通用工具
 * （PRD docs/PRD/novel-tools-通用合并.md）。
 */
import { ToolGroupManifest } from "../ToolGroupManifest.js";
import type { ToolDef } from "../ToolDef.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";
import type { ConversationTodoStore } from "../../todo/TodoProtocol.js";
import type { ComposeModeService } from "../../../conversation/compose/index.js";
import { createFileTools } from "../definitions/files.js";
import { createTodoWriteTool } from "../definitions/todo.js";
import { createSkillTool } from "../definitions/skill.js";
import { createComposeTools } from "../definitions/compose.js";
import { createAskUserTool } from "../definitions/askUser.js";
import type { AskUserChannel } from "../definitions/askUser.js";
import { createNovelEntityTools } from "../definitions/novel.js";
import { createNovelImportTextTool } from "../definitions/novelImportText.js";
import { createLibraryReadTool } from "../definitions/library.js";
import type { LibraryReadDeps } from "../definitions/library.js";
import type { SkillRegistry } from "../../skill/SkillRegistry.js";

/** runtime.todo：会话执行计划（TodoWrite） */
export const NOVEL_TOOL_GROUP_TODO = new ToolGroupManifest({
  id: "runtime.todo",
  version: "1.0.0",
  label: "Runtime Todo",
  description: "会话执行计划（TodoWrite 全量替换）",
  tools: ["TodoWrite"],
});

/** runtime.files：workspace 文件工具 */
export const NOVEL_TOOL_GROUP_FILES = new ToolGroupManifest({
  id: "runtime.files",
  version: "1.0.0",
  label: "Runtime Files",
  description: "workspace 沙盒文件读写（Read/Glob/Write/Edit）",
  tools: ["Read", "Glob", "Write", "Edit"],
});

/** runtime.ask：向作者提问（AskUserQuestion；挂起等待作答） */
export const NOVEL_TOOL_GROUP_ASK = new ToolGroupManifest({
  id: "runtime.ask",
  version: "1.0.0",
  label: "Runtime Ask",
  description: "向作者提问（选择题/开放填空题，AskUserQuestion 挂起等待作答）",
  tools: ["AskUserQuestion"],
});

/** runtime.skills：技能读取（skill 元工具；Agent Skills 开放标准装载） */
export const NOVEL_TOOL_GROUP_SKILLS = new ToolGroupManifest({
  id: "runtime.skills",
  version: "1.0.0",
  label: "Runtime Skills",
  description: "技能读取（skill：按名读取已装载技能的 SKILL.md 完整说明）",
  tools: ["skill"],
});

/** novel.compose：设计模式进入/退出（Exit 硬审批门） */
export const NOVEL_TOOL_GROUP_COMPOSE = new ToolGroupManifest({
  id: "novel.compose",
  version: "1.0.0",
  label: "Novel Compose",
  description: "设计模式进入/退出（EnterComposeMode / ExitComposeMode，exit 走审批）",
  tools: ["EnterComposeMode", "ExitComposeMode"],
});

/** novel.entities：小说实体通用读/写/改/删（kind 分发） */
export const NOVEL_TOOL_GROUP_ENTITIES = new ToolGroupManifest({
  id: "novel.entities",
  version: "1.0.0",
  label: "Novel Entities",
  description:
    "小说实体通用工具（NovelRead/NovelWrite/NovelEdit/NovelDelete，kind 分发：overview/character/location/story_unit/paragraph/volume/chapter）",
  tools: ["NovelRead", "NovelWrite", "NovelEdit", "NovelDelete"],
});

/** analyst.files：书库解析会话免审批文件四件套（后台无人应答审批） */
export const NOVEL_TOOL_GROUP_ANALYST_FILES = new ToolGroupManifest({
  id: "analyst.files",
  version: "1.0.0",
  label: "Analyst Files",
  description: "书库解析会话专用文件四件套（Read/Glob/Write/Edit 免审批，沙盒=书库根）",
  tools: ["Read", "Glob", "Write", "Edit"],
});

/** library.read：书库只读引用（novel 主 Agent 经工作区书单访问全局书库） */
export const NOVEL_TOOL_GROUP_LIBRARY = new ToolGroupManifest({
  id: "library.read",
  version: "1.0.0",
  label: "Library Read",
  description: "书库只读工具（LibraryRead：overview/实体/分段/风格/摘录，kind 分发）",
  tools: ["LibraryRead"],
});

/** novel.import：导入书稿正文区间落库（ProjectImporter 专用——段落随场景导入） */
export const NOVEL_TOOL_GROUP_IMPORT = new ToolGroupManifest({
  id: "novel.import",
  version: "1.0.0",
  label: "Novel Import Text",
  description:
    "导入解构专用（NovelImportText：批次文件原文按段落区间落库到指定单元；参数无文本，宿主搬运）",
  tools: ["NovelImportText"],
});

/** Novel Agent 工具组目录：groupId → manifest（有序插入，与 definition.tools.groupIds 对齐） */
export const NOVEL_TOOL_GROUP_CATALOG: ReadonlyMap<string, ToolGroupManifest> = new Map([
  [NOVEL_TOOL_GROUP_TODO.id, NOVEL_TOOL_GROUP_TODO],
  [NOVEL_TOOL_GROUP_FILES.id, NOVEL_TOOL_GROUP_FILES],
  [NOVEL_TOOL_GROUP_ASK.id, NOVEL_TOOL_GROUP_ASK],
  [NOVEL_TOOL_GROUP_SKILLS.id, NOVEL_TOOL_GROUP_SKILLS],
  [NOVEL_TOOL_GROUP_COMPOSE.id, NOVEL_TOOL_GROUP_COMPOSE],
  [NOVEL_TOOL_GROUP_ENTITIES.id, NOVEL_TOOL_GROUP_ENTITIES],
  [NOVEL_TOOL_GROUP_ANALYST_FILES.id, NOVEL_TOOL_GROUP_ANALYST_FILES],
  [NOVEL_TOOL_GROUP_LIBRARY.id, NOVEL_TOOL_GROUP_LIBRARY],
  [NOVEL_TOOL_GROUP_IMPORT.id, NOVEL_TOOL_GROUP_IMPORT],
]);

/** 工具组工厂选项（workspace / novel handle / todo 闭包 / compose 闭包） */
export interface NovelToolGroupResolverOptions {
  /** 工作区路径（文件工具） */
  workspace: string;
  /** novel 客户端（novel 域工具 query/mutate 对接） */
  handle: NovelHandle;
  /** Todo 存储（runtime.todo 组 TodoWrite；由 buildNovelAgent 注入缺省实例） */
  todoStore: ConversationTodoStore;
  /** 会话 id（TodoWrite 状态键；缺省空串——仅测试/直构路径，生产恒传真实 id） */
  todoConversationId: string;
  /** compose 服务 + 会话（novel.compose 组 Enter/ExitComposeMode；由 buildNovelAgent 注入，缺省自建兜底） */
  compose?: { service: ComposeModeService; conversationId: string };
  /** 提问通道（runtime.ask 组 AskUserQuestion；由 buildNovelAgent 注入，缺省工具回「未送达」文本） */
  ask?: { channel: AskUserChannel; conversationId: string };
  /** 技能注册表（runtime.skills 组 skill；缺省=未装配降级，工具回「未装配」文本，对齐 runtime.ask 先例） */
  skills?: { registry: SkillRegistry };
  /** 书库服务（library.read 组 LibraryRead；workspace 同上作为书单访问控制根。缺省组装配报错） */
  library?: { deps: LibraryReadDeps };
  /** novel.entities 写工具审批覆盖（缺省 true=需审批；BookAnalyst 后台无人审批会话传 false，对齐 analyst.files 免审批先例） */
  entityApproval?: boolean;
  /**
   * novel.import 组装配（ProjectImporter 专用）：原始（未守卫）handle——导入工具的
   * 确定性写通道（paragraph.insert + 章回填）；workspace 用顶层 workspace 字段。
   * 缺省=未装配（组不在 definition.groupIds 即不解析，无降级必要）。
   */
  importText?: { handle: NovelHandle };
}

/**
 * 创建工具组解析器：manifest → ToolDef[]（按 manifest.tools 名称解析，缺工具报错）。
 * @param options workspace + novel handle + todo 存储/会话 + compose 服务
 * @returns 组解析函数
 */
export function createNovelToolGroupResolver(
  options: NovelToolGroupResolverOptions,
): (manifest: ToolGroupManifest) => ToolDef[] {
  const factories: ReadonlyMap<string, () => ToolDef[]> = new Map([
    [
      "runtime.todo",
      () => [createTodoWriteTool(options.todoStore, options.todoConversationId)],
    ],
    ["runtime.files", () => createFileTools(options.workspace)],
    [
      "analyst.files",
      // 文件写本就免审批（沙盒内可逆）；该组差异在沙盒=书库根（runtime.files 同工厂）
      () => createFileTools(options.workspace),
    ],
    // library.read：deps 缺省=未装配降级（工具回不可用文本，对齐 runtime.ask 先例）
    ["library.read", () => [createLibraryReadTool({ deps: options.library?.deps })]],
    [
      "runtime.ask",
      () => [createAskUserTool(options.ask?.channel, options.ask?.conversationId ?? "")],
    ],
    // runtime.skills：registry 缺省=未装配降级（工具回不可用文本，对齐 runtime.ask 先例）
    ["runtime.skills", () => [createSkillTool(options.skills?.registry)]],
    [
      "novel.compose",
      () => {
        if (options.compose === undefined) {
          throw new TypeError("Tool Group novel.compose requires compose service");
        }
        return createComposeTools(options.compose.service, options.compose.conversationId);
      },
    ],
    [
      "novel.entities",
      () =>
        createNovelEntityTools(
          options.handle,
          options.entityApproval !== undefined ? { requireApproval: options.entityApproval } : undefined,
        ),
    ],
    [
      "novel.import",
      () => {
        if (options.importText === undefined) {
          throw new TypeError("Tool Group novel.import requires importText deps (raw handle)");
        }
        return [
          createNovelImportTextTool({ workspaceRoot: options.workspace, handle: options.importText.handle }),
        ];
      },
    ],
  ]);
  return (manifest) => {
    const factory = factories.get(manifest.id);
    if (factory === undefined) {
      throw new TypeError(`Tool Group factory is unknown: ${manifest.id}`);
    }
    const defs = factory();
    return manifest.tools.map((name) => {
      const tool = defs.find((d) => d.name === name);
      if (tool === undefined) {
        throw new TypeError(`Tool Group ${manifest.id} is missing tool: ${name}`);
      }
      return tool;
    });
  };
}
