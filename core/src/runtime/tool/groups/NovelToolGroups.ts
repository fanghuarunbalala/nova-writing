/**
 * Novel Agent 工具组：10 组 manifest（展示层）+ 组工厂解析器（manifest → ToolDef[]）。
 * Novel Agent tool groups: 10 group manifests (display layer) plus a group
 * factory resolver (manifest → ToolDef[]).
 *
 * 组声明与工具工厂分离：manifest 是配置展示层，工厂按 manifest.tools 名称
 * 解析实际工具定义（缺工具报错）。
 */
import { ToolGroupManifest } from "../ToolGroupManifest.js";
import type { ToolDef } from "../ToolDef.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";
import type { ConversationTodoStore } from "../../todo/TodoProtocol.js";
import type { ComposeModeService } from "../../../conversation/compose/index.js";
import { createFileTools } from "../definitions/files.js";
import { createTodoWriteTool } from "../definitions/todo.js";
import { createComposeTools } from "../definitions/compose.js";
import {
  createCharacterTools,
  createLocationTools,
  createOutlineTools,
  createParagraphTools,
  createVolumeTools,
  createChapterTools,
  createDeleteTool,
} from "../definitions/novel.js";

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

/** novel.compose：设计模式进入/退出（Exit 硬审批门） */
export const NOVEL_TOOL_GROUP_COMPOSE = new ToolGroupManifest({
  id: "novel.compose",
  version: "1.0.0",
  label: "Novel Compose",
  description: "设计模式进入/退出（EnterComposeMode / ExitComposeMode，exit 走审批）",
  tools: ["EnterComposeMode", "ExitComposeMode"],
});

/** novel.characters：人物档案 */
export const NOVEL_TOOL_GROUP_CHARACTERS = new ToolGroupManifest({
  id: "novel.characters",
  version: "1.0.0",
  label: "Novel Characters",
  description: "人物档案读/写/改",
  tools: ["NovelCharacterRead", "NovelCharacterWrite", "NovelCharacterEdit"],
});

/** novel.locations：地点档案 */
export const NOVEL_TOOL_GROUP_LOCATIONS = new ToolGroupManifest({
  id: "novel.locations",
  version: "1.0.0",
  label: "Novel Locations",
  description: "地点档案读/写/改",
  tools: ["NovelLocationRead", "NovelLocationWrite", "NovelLocationEdit"],
});

/** novel.outline：大纲结构 */
export const NOVEL_TOOL_GROUP_OUTLINE = new ToolGroupManifest({
  id: "novel.outline",
  version: "1.0.0",
  label: "Novel Outline",
  description: "大纲单元读/写/改",
  tools: ["NovelOutlineRead", "NovelOutlineWrite", "NovelOutlineEdit"],
});

/** novel.paragraph：正文段落 */
export const NOVEL_TOOL_GROUP_PARAGRAPH = new ToolGroupManifest({
  id: "novel.paragraph",
  version: "1.0.0",
  label: "Novel Paragraph",
  description: "正文段落读/写/改",
  tools: ["NovelParagraphRead", "NovelParagraphWrite", "NovelParagraphEdit"],
});

/** novel.volumes：卷（发布结构拆分六件套之一） */
export const NOVEL_TOOL_GROUP_VOLUMES = new ToolGroupManifest({
  id: "novel.volumes",
  version: "1.0.0",
  label: "Novel Volumes",
  description: "卷读/写/改",
  tools: ["NovelVolumeRead", "NovelVolumeWrite", "NovelVolumeEdit"],
});

/** novel.chapters：章（发布结构拆分六件套之一） */
export const NOVEL_TOOL_GROUP_CHAPTERS = new ToolGroupManifest({
  id: "novel.chapters",
  version: "1.0.0",
  label: "Novel Chapters",
  description: "章读/写/改",
  tools: ["NovelChapterRead", "NovelChapterWrite", "NovelChapterEdit"],
});

/** novel.delete：删除（高风险，requireApproval 门控） */
export const NOVEL_TOOL_GROUP_DELETE = new ToolGroupManifest({
  id: "novel.delete",
  version: "1.0.0",
  label: "Novel Delete",
  description: "删除实体（章节/人物/地点/大纲单元）",
  tools: ["NovelDelete"],
});

/** Novel Agent 工具组目录：groupId → manifest（有序插入，与 definition.tools.groupIds 对齐） */
export const NOVEL_TOOL_GROUP_CATALOG: ReadonlyMap<string, ToolGroupManifest> = new Map([
  [NOVEL_TOOL_GROUP_TODO.id, NOVEL_TOOL_GROUP_TODO],
  [NOVEL_TOOL_GROUP_FILES.id, NOVEL_TOOL_GROUP_FILES],
  [NOVEL_TOOL_GROUP_COMPOSE.id, NOVEL_TOOL_GROUP_COMPOSE],
  [NOVEL_TOOL_GROUP_CHARACTERS.id, NOVEL_TOOL_GROUP_CHARACTERS],
  [NOVEL_TOOL_GROUP_LOCATIONS.id, NOVEL_TOOL_GROUP_LOCATIONS],
  [NOVEL_TOOL_GROUP_OUTLINE.id, NOVEL_TOOL_GROUP_OUTLINE],
  [NOVEL_TOOL_GROUP_PARAGRAPH.id, NOVEL_TOOL_GROUP_PARAGRAPH],
  [NOVEL_TOOL_GROUP_VOLUMES.id, NOVEL_TOOL_GROUP_VOLUMES],
  [NOVEL_TOOL_GROUP_CHAPTERS.id, NOVEL_TOOL_GROUP_CHAPTERS],
  [NOVEL_TOOL_GROUP_DELETE.id, NOVEL_TOOL_GROUP_DELETE],
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
      "novel.compose",
      () => {
        if (options.compose === undefined) {
          throw new TypeError("Tool Group novel.compose requires compose service");
        }
        return createComposeTools(options.compose.service, options.compose.conversationId);
      },
    ],
    ["novel.characters", () => createCharacterTools(options.handle)],
    ["novel.locations", () => createLocationTools(options.handle)],
    ["novel.outline", () => createOutlineTools(options.handle)],
    ["novel.paragraph", () => createParagraphTools(options.handle)],
    ["novel.volumes", () => createVolumeTools(options.handle)],
    ["novel.chapters", () => createChapterTools(options.handle)],
    ["novel.delete", () => createDeleteTool(options.handle)],
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
