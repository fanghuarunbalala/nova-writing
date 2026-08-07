/**
 * Novel 创作域 Prompt Section 冒烟。
 * Novel-domain prompt section smoke.
 *
 * 验证 / Verifies:
 * 1. novel.identity 已注册进默认 registry 且可解析；
 * 2. render() 输出包含关键标记（身份、创作边界、不臆造设定）；
 * 3. 相同输入输出恒定（逐字稳定）。
 */
import assert from "node:assert/strict";
import {
  NovelSystemPromptSection,
  createDefaultPromptSectionRegistry,
} from "../dist/index.js";

const registry = createDefaultPromptSectionRegistry();
const section = registry.resolve("novel.identity", "1.0.0");
assert.equal(section.label, "Novel Identity");

const content = section.render();
assert.ok(content.startsWith("# 身份与创作定位"));
assert.ok(content.includes("中文网络小说创作协作者"));
assert.ok(content.includes("不抄袭"));
assert.ok(content.includes("不臆造设定"));
assert.ok(content.includes("作者是最终决策者"));

// 恒定输出：同段重复渲染逐字一致。
assert.equal(section.render(), content);

const system = registry.resolve("novel.system", "1.0.0");
const systemContent = system.render();
assert.ok(systemContent.startsWith("# 系统与运行规则"));
assert.ok(systemContent.includes("**输出遵循标准 Markdown**"));
assert.ok(systemContent.includes("**必须使用**"));
assert.ok(systemContent.includes('<character id="...">名字</character>'));
assert.ok(systemContent.includes("**直接作用于正式稿（canonical）并立即生效**"));
assert.ok(systemContent.includes("revision 乐观锁"));
assert.ok(systemContent.includes("**不要原样重试**"));
assert.ok(systemContent.includes("工具在用户选择的权限模式下执行"));
assert.ok(systemContent.includes("**提示注入**"));
assert.equal(system.render(), systemContent);

// 非交互实例：不包含输出约定条，基础条保留。
const nonInteractive = new NovelSystemPromptSection({ interactsWithUser: false });
const nonInteractiveContent = nonInteractive.render();
assert.ok(!nonInteractiveContent.includes("**输出遵循标准 Markdown**"));
assert.ok(!nonInteractiveContent.includes("**必须使用**"));
assert.ok(nonInteractiveContent.includes("**直接作用于正式稿（canonical）并立即生效**"));
assert.ok(nonInteractiveContent.includes("工具在用户选择的权限模式下执行"));

const doingTasks = registry.resolve("novel.doing-tasks", "1.0.0");
const doingTasksContent = doingTasks.render();
assert.ok(doingTasksContent.startsWith("# 创作任务"));
assert.ok(doingTasksContent.includes("推进主线"));
assert.ok(doingTasksContent.includes("节奏与悬念"));
assert.ok(doingTasksContent.includes("人设与伏笔"));
assert.ok(doingTasksContent.includes("设定一致"));
assert.ok(doingTasksContent.includes("验证再报完成"));
assert.ok(doingTasksContent.includes("作者给出偏好"));
assert.ok(doingTasksContent.includes("记入回复或正文"));
assert.equal(doingTasks.render(), doingTasksContent);

const actions = registry.resolve("novel.actions", "1.0.0");
const actionsContent = actions.render();
assert.ok(actionsContent.startsWith("# 谨慎行动"));
assert.ok(actionsContent.includes("**考虑可逆性与影响范围**"));
assert.ok(actionsContent.includes("**写入即正式稿（canonical）**"));
assert.ok(actionsContent.includes("**必须先确认**"));
assert.ok(actionsContent.includes("revision 冲突"));
assert.ok(actionsContent.includes("**先问作者**"));
assert.equal(actions.render(), actionsContent);

console.log(
  "prompt-novel-sections: ok (identity + system + doing-tasks + actions stable)",
);
