/**
 * 写作焦点存储（PRD 检索式形态示例 F3）：NovelWrite/NovelEdit 工具成功执行后
 * 记录当前写作目标（story_unit 归属），stylelib 注入 provider 据此构造检索查询。
 * 进程内内存态（todoStore 同款会话共享件）：重启丢失无碍——下次写作工具调用即重建；
 * 无焦点（纯设定/闲聊）= 不注入。
 */

/** 写作焦点快照 */
export interface WritingFocusSnapshot {
	/** 工具 kind（story_unit / paragraph / chapter） */
	readonly kind: string;
	/** 焦点大纲单元 id（检索目标；缺省 = 不构成焦点） */
	readonly storyUnitId?: string;
	/** 记录时刻（epoch ms） */
	readonly capturedAt: number;
}

/** 焦点记录面（工具侧写；WritingFocusStore 为其内存实现） */
export interface WritingFocusRecorder {
	record(focus: WritingFocusSnapshot): void;
}

/**
 * 会话级写作焦点存储（main agent 工具面与 stylelib provider 共享）
 */
export class WritingFocusStore implements WritingFocusRecorder {
	private focus: WritingFocusSnapshot | undefined;

	/**
	 * 记录焦点（storyUnitId 缺省的快照不构成焦点，忽略）
	 * @param focus 工具侧快照
	 */
	record(focus: WritingFocusSnapshot): void {
		if (focus.storyUnitId === undefined || focus.storyUnitId.length === 0) return;
		this.focus = focus;
	}

	/** 当前焦点（无 = undefined，注入侧跳过） */
	current(): WritingFocusSnapshot | undefined {
		return this.focus;
	}
}
