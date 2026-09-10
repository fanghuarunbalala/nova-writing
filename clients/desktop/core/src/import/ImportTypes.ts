/**
 * 项目导入共享类型（欢迎页「从文件导入创建项目」）：预览/计划（卷章结构与字数）、
 * 导入元数据（.novel/import/import.json）、进度。本文件保持 browser-safe（client 面
 * type-only 引入）；node 侧解析/落库见 ImportSourceReader / ProjectImportService。
 * 与书库（library）严格区分：导入内容直接落进本项目 novel.db，是可继续写作的正典数据。
 */

/** 卷（预览/计划项；无卷标记的书 volumes 为空、章 volumeKey=null） */
export interface ImportVolumePreview {
	/** 卷 key（解析产物稳定标识：v1、v2…；预览→计划→落库以 key 关联） */
	readonly key: string;
	/** 卷标题（原文卷标记行；可在计划中修改） */
	title: string;
}

/** 章（预览/计划项；全书顺序排列） */
export interface ImportChapterPreview {
	/** 章 key（解析产物稳定标识：c1、c2…全书连续） */
	readonly key: string;
	/** 章标题（可在计划中修改） */
	title: string;
	/** 章字符数（章内各批字符数之和） */
	readonly chars: number;
	/** 归属卷 key（null = 未分卷；可在计划中调整到任意既有卷或移出为未分卷） */
	volumeKey: string | null;
}

/** 导入预览（确定性解析产物；UI 微调后作为 ImportPlan 提交） */
export interface ImportPreview {
	/** 源文件名（zip 取 zip 包文件名） */
	readonly sourceName: string;
	/** 源类型 */
	readonly kind: "txt" | "zip";
	/** 全书字符数 */
	readonly totalChars: number;
	/** 卷列表（仅解析出卷标记的卷；顺序 = 原文出现顺序） */
	readonly volumes: readonly ImportVolumePreview[];
	/** 章列表（全书顺序） */
	readonly chapters: readonly ImportChapterPreview[];
	/** zip 内被忽略的非 txt 条目（相对路径） */
	readonly skippedFiles: readonly string[];
}

/** 导入计划 = 预览同构（key 关联解析产物；title/volumeKey 为用户确认稿，落库以计划为准） */
export type ImportPlan = ImportPreview;

/** 导入统计 */
export interface ImportStats {
	readonly volumes: number;
	readonly chapters: number;
	readonly paragraphs: number;
	readonly batches: number;
	readonly chars: number;
}

/** 导入解构状态（import.json.status）：analyzing=确定性导入完成、ProjectImporter 会话进行中；
 * analyzed/failed 由 agent 收尾翻转（宿主重试/降级时也会写 failed） */
export type ImportStatus = "analyzing" | "analyzed" | "failed";

/** 导入元数据（<workspaceRoot>/.novel/import/import.json） */
export interface ImportMeta {
	readonly importId: string;
	readonly status: ImportStatus;
	readonly statusReason?: string;
	readonly sourceName: string;
	readonly stats: ImportStats;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** 解构进度（outline 覆盖 + journal 双信号推导；UI 3s 轮询读面） */
export interface ImportProgress {
	/** 当前状态（无 import.json = none：非导入创建的项目） */
	readonly status: ImportStatus | "none";
	/** 全书分批总数（manifest 条数） */
	readonly totalBatches: number;
	/** 已覆盖分批序（读取游标） */
	readonly coveredBatches: number;
	/** 百分比 0–100 */
	readonly percent: number;
	/** 尚无覆盖信号（进度不可定） */
	readonly indeterminate: boolean;
	/** 已建 story unit 数 */
	readonly unitCount: number;
	/** 失败原因（status=failed 时） */
	readonly statusReason?: string;
	/** 疑似卡住（status=analyzing 且 journal/状态超过 10 分钟无更新——端点停滞或会话中断；
	 * UI 提示并提供重试，正文与章卷不受影响） */
	readonly stalled?: boolean;
}

/** 项目导入结果（终态语义见 ImportJobResult；保留类型供解构进度等场景复用） */
export interface ProjectImportResult {
	/** 新项目引用（用于常规打开编排） */
	readonly reference: { readonly referenceId: string; readonly label: string };
	readonly stats: ImportStats;
	/** 解构会话 id（派生成功时） */
	readonly conversationId?: string;
	/** 未派生解构的原因（确定性导入已完成，可打开项目后重试解构） */
	readonly spawnSkipped?: string;
}

/**
 * createProjectFromImport 返回（任务式）：canceled=true = 用户在 save 对话框取消（无副作用）；
 * canceled=false = 任务已启动（引用即刻返回，stats/解构派生经 createProgress 轮询取终态）——
 * RPC 即刻返回，长耗时操作不再占请求（kkrpc 默认 30s 超时约束下的必然形态）
 */
export type ProjectImportCreateResult =
	| { readonly canceled: true }
	| { readonly canceled: false; readonly reference: { readonly referenceId: string; readonly label: string } };

/** 导入任务阶段（耗时操作在后台进程执行；阶段经 createProgress 轮询驱动 UI 动画） */
export type ImportJobStage = "reading" | "parsing" | "writing-files" | "writing-db";

/** 导入任务进度（done/total 同为 0 = 该阶段不可定量，UI 走不确定态动画） */
export interface ImportJobProgress {
	readonly stage: ImportJobStage;
	readonly done: number;
	readonly total: number;
}

/** 导入创建任务的终态产物（phase=succeeded 时随 createProgress 返回） */
export interface ImportJobResult {
	/** 新项目引用 */
	readonly reference: { readonly referenceId: string; readonly label: string };
	readonly stats: ImportStats;
	/** 解构会话 id（派生成功时） */
	readonly conversationId?: string;
	/** 未派生解构的原因（导入已完成，可打开项目后重试） */
	readonly spawnSkipped?: string;
}

/** 导入创建任务状态（任务式：createProjectFromImport 立即返回，终态经 createProgress 轮询） */
export interface ImportJobStatus {
	/** running=后台链执行中（落库/派生）；succeeded/failed 为终态（保留至下次创建） */
	readonly phase: "running" | "succeeded" | "failed";
	/** running 期间的阶段进度（无 runner 或不可定量 = null） */
	readonly progress: ImportJobProgress | null;
	/** 终态产物（phase=succeeded） */
	readonly result?: ImportJobResult;
	/** 失败原因（phase=failed） */
	readonly error?: string;
}
