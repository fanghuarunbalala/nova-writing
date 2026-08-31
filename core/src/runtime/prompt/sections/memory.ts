/**
 * memory.index 动态段（PRD memory-两层记忆 M2）：每调用渲染动态记忆索引
 * （MEMORY.md 的 active 条目，提供者已按 agent 过滤/截断）。
 *
 * 空索引（无条目/目录缺失）返回空串——段整体省略，对齐 skill.index 先例
 * （没有记忆时不注入记忆使用说明，避免噪声）。段内容包含使用契约：
 * 详情用 Read 直读 memory/<name>.md；信任边界（point-in-time，冲突信当下）；
 * 与静态层的关系（静态声明优先）。
 */
import type { PromptSection } from "../PromptSection.js";

const TYPE_LABELS: Record<string, string> = {
  author: "作者画像",
  feedback: "改稿反馈",
  project: "项目决策",
  reference: "外部指针",
};

export const memoryIndexSection: PromptSection = {
  kind: "dynamic",
  id: "memory.index",
  version: "1.0.0",
  label: "Memory Index",
  renderDynamic: (input) => {
    const snapshot = input.memoryIndex;
    if (snapshot === undefined || snapshot.entries.length === 0) return "";
    const lines = snapshot.entries.map(
      (e) => `- ${e.name} — ${e.description}（${TYPE_LABELS[e.type] ?? e.type}）`,
    );
    return [
      "# 跨会话记忆（memory/ 索引）",
      "",
      "以下是你从历次会话中学到的、跨会话仍然有效的记忆条目索引（一行一条）：",
      "",
      ...lines,
      "",
      ...(snapshot.truncated ? ["（索引超注入预算已截断；完整清单在 memory/MEMORY.md，磁盘文件完整）", ""] : []),
      "使用契约：",
      "- **详情按需读**：需要某条的完整内容（规则/Why/How to apply）时用 Read 读 `memory/<name>.md`（如 memory/pov-preference.md）。",
      "- **信任边界**：记忆是 point-in-time 记录，只证明「写入时如此」。其中引用的实体事实（角色状态、剧情进度）用于生成前必须回实体库核实；与当前现实冲突时**信当下**。",
      "- **优先级**：NOVEL.md 静态声明（项目层 > 全局层）优先于记忆；记忆与静态层冲突时不按记忆执行。",
      "- **维护**：学到值得跨会话保留的内容用 MemoryWrite 写入；改口用 MemoryWrite 带 supersedes（旧条目自动 superseded）。作者明确要求遗忘用 MemoryForget（需作者审批）。",
    ].join("\n");
  },
};
