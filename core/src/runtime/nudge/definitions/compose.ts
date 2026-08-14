/**
 * compose_mode / compose_mode_exit nudge（从旧 main 分支迁移）。
 * transition 驱动：compose 状态 false→true 发 compose_mode，true→false 发 compose_mode_exit。
 * main agent 专属（依赖 ComposeModeStateProvider + conversationId）。
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunProgress } from "../../loop/types.js";
import type { ContextNudgePolicy } from "../ContextNudgePolicy.js";
import type { ComposeModeStateProvider } from "../../../conversation/compose/ComposeModeState.js";

/** 进入设计模式文案 */
function renderComposeModeFullText(designFilePath?: string): string {
  return [
    "# 设计模式（Compose Mode）",
    "当前处于**设计模式**：",
    "- 正式稿只读：canonical 写入工具会被拒绝；文件工具（Read/Glob/Write/Edit）全模式可用，路径一律用 **workspace 相对路径**（越出 workspace 沙盒会报错），草稿请维护在 `.novel/design/` 设计目录。",
    "- 逐步写出你要创作的内容（大纲或正文），用 Write/Edit 增量完善草稿。",
    "- 草稿完成后调用 **ExitComposeMode** 提交审批；**不要用文本询问审批**。",
    "- 如果作者拒绝了草稿：按反馈修订草稿文件后重新提交，**不要原样重试**。",
    ...(designFilePath === undefined ? [] : [`- 当前会话设计文件：\`${designFilePath}\``]),
  ].join("\n");
}

/** 退出设计模式文案 */
const COMPOSE_MODE_EXIT_TEXT = [
  "# 设计模式已结束",
  "正式稿写入已恢复。请按审批结果继续创作：",
  "- 若已批准：按草稿内容将正文写入正式稿（canonical 写入工具已恢复）。",
  "- 若已放弃：草稿文件保留在会话设计目录中，可随时重新进入设计模式。",
].join("\n");

/** compose 模式 transition 提示策略（main agent 专属） */
export class ComposeModeNudgePolicy implements ContextNudgePolicy {
	/** 上次观察到的 active 状态（transition 检测 latch） */
	private lastActive = false;
	/** compose 状态提供者 */
	private readonly composeState: ComposeModeStateProvider;
	/** 会话 id（main agent） */
	private readonly conversationId: string;

	/**
	 * 构造 ComposeModeNudgePolicy
	 * @param composeState compose 状态提供者
	 * @param conversationId 会话 id
	 */
	constructor(composeState: ComposeModeStateProvider, conversationId: string) {
		this.composeState = composeState;
		this.conversationId = conversationId;
	}

	/** 持久提示注入：compose 状态 transition 时发 reminder */
	persistentNudgeIfNeeded(loop: LoopContext, _run: RunProgress): boolean {
		const snap = this.composeState.snapshot(this.conversationId);
		const active = snap.active;
		if (active && !this.lastActive) {
			// false → true：进入设计模式
			this.lastActive = active;
			loop.appendRunMessages([{ role: "system", content: renderComposeModeFullText(snap.designFilePath) }]);
			return true;
		}
		if (!active && this.lastActive) {
			// true → false：退出设计模式
			this.lastActive = active;
			loop.appendRunMessages([{ role: "system", content: COMPOSE_MODE_EXIT_TEXT }]);
			return true;
		}
		this.lastActive = active;
		return false;
	}

	/** 瞬时注入：不适用 */
	transientNudgeIfNeeded(): boolean {
		return false;
	}
}
