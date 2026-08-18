/**
 * AskUserQuestion 工具：向作者提问（选择题 + 开放填空题）。
 * handler 经注入的 ask 通道挂起等待作者作答（ConversationAskingRequest → CMS wait 队列 →
 * UI 卡片 → resolveQuestion 回传），答案作为工具结果回到对话流，循环继续。
 * 与 requestApproval 同款延迟 RPC 模式；提问不设 bypass 短路（答案只在作者手里）。
 */
import type { ToolDef } from "../ToolDef.js";
import { askUserPreview } from "../previews.js";
import type { ToolCall } from "../../provider/types.js";
import type {
	AskOptionSpec,
	AskQuestionAnswer,
	AskQuestionSpec,
	ConversationAskingRequest,
	RequestId,
} from "../../../conversation/contract/types/index.js";
import { ToolError } from "../errors.js";

/** 提问通道：组请求 → 挂起直到作者作答（生产 = conv.sendAskingQuestionRequest 闭包） */
export type AskUserChannel = (
	req: ConversationAskingRequest,
) => Promise<readonly AskQuestionAnswer[]>;

/** 解析 tool args JSON */
function parseArgs(call: ToolCall): { questions: unknown[] } {
	try {
		const args = JSON.parse(call.args) as { questions?: unknown };
		if (!Array.isArray(args.questions)) {
			throw new Error("questions 必须是数组");
		}
		return { questions: args.questions };
	} catch (error) {
		throw new ToolError(
			{ code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
			`无效的 JSON 参数: ${call.args}（${error instanceof Error ? error.message : String(error)}）`,
		);
	}
}

/** 单问归一（schema 外的防御性校验：形状/数量不合法即拒绝，不静默吞） */
function toQuestionSpec(raw: unknown, index: number): AskQuestionSpec {
	if (typeof raw !== "object" || raw === null) {
		throw new ToolError(
			{ code: "TOOL_ARGUMENTS_INVALID", toolName: "AskUserQuestion" },
			`questions[${index}] 不是对象`,
		);
	}
	const q = raw as Record<string, unknown>;
	const question = typeof q.question === "string" ? q.question.trim() : "";
	const header = typeof q.header === "string" ? q.header.trim() : "";
	if (question === "" || header === "") {
		throw new ToolError(
			{ code: "TOOL_ARGUMENTS_INVALID", toolName: "AskUserQuestion" },
			`questions[${index}] 缺 question 或 header`,
		);
	}
	const spec: AskQuestionSpec = { question, header };
	if (typeof q.context === "string" && q.context.trim() !== "") spec.context = q.context;
	if (typeof q.placeholder === "string" && q.placeholder.trim() !== "") {
		spec.placeholder = q.placeholder;
	}
	if (q.multiSelect === true) spec.multiSelect = true;
	if (q.options !== undefined) {
		if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
			throw new ToolError(
				{ code: "TOOL_ARGUMENTS_INVALID", toolName: "AskUserQuestion" },
				`questions[${index}].options 必须是 2-4 个（开放填空题省略 options）`,
			);
		}
		spec.options = q.options.map((o, oi) => {
			if (typeof o !== "object" || o === null) {
				throw new ToolError(
					{ code: "TOOL_ARGUMENTS_INVALID", toolName: "AskUserQuestion" },
					`questions[${index}].options[${oi}] 不是对象`,
				);
			}
			const opt = o as Record<string, unknown>;
			if (typeof opt.label !== "string" || opt.label.trim() === "" || typeof opt.description !== "string") {
				throw new ToolError(
					{ code: "TOOL_ARGUMENTS_INVALID", toolName: "AskUserQuestion" },
					`questions[${index}].options[${oi}] 缺 label 或 description`,
				);
			}
			return { label: opt.label.trim(), description: opt.description } satisfies AskOptionSpec;
		});
	}
	if (spec.options !== undefined && spec.placeholder !== undefined) {
		throw new ToolError(
			{ code: "TOOL_ARGUMENTS_INVALID", toolName: "AskUserQuestion" },
			`questions[${index}] 同时给了 options 与 placeholder：选择题省略 placeholder；开放填空题省略 options（只有一个文本框，不带选项）`,
		);
	}
	return spec;
}

/** 单问回答格式化为模型可读行 */
function formatAnswer(spec: AskQuestionSpec | undefined, answer: AskQuestionAnswer): string {
	if (answer.skipped === true) {
		return `- 「${answer.question}」跳过（作者授权自行决断）`;
	}
	const specOptions = spec?.options ?? [];
	const parts: string[] = [];
	if (answer.selections.length > 0) {
		parts.push(`选择：${answer.selections.join("、")}`);
	}
	if (answer.text !== undefined && answer.text.trim() !== "") {
		parts.push(`自填：${answer.text.trim()}`);
	}
	const detail = parts.length > 0 ? parts.join("｜") : "（空）";
	const recommended =
		specOptions.length > 0 && answer.selections.length > 0
			? answer.selections.some((label) => {
					const matched = specOptions.find((o) => o.label === label);
					return matched !== undefined && /（推荐）$/.test(matched.label);
				})
				? "（作者采纳了推荐）"
				: ""
			: "";
	return `- 「${answer.question}」${detail}${recommended}`;
}

/** AskUserQuestion 描述（CC 风格：何时用 / 何时不用 / 示例 / 字段细则） */
const ASK_USER_QUESTION_DESCRIPTION = [
  "向作者提出选择题或开放填空题：确认走向、澄清歧义、取舍偏好、采集创意。提问会暂停生成，作者作答后继续。**提问是打断性操作——能基于现有信息推断的先给出建议，只在真实分叉或信息只存在于作者脑中时使用；一次 ≤2 问。**",
  "选择题的作者始终可选「其他」自由输入；有推荐选项时放第一位，并在 label 末尾加「（推荐）」。",
  "",
  "## 何时使用",
  "1. 指令存在多种合理解读，且选错方向会浪费整章/整节的写作量——用选择题让作者拍板。",
  "2. 故事走向出现真实分叉（结局、人物生死、视角切换、时间线跳跃），指令与大纲均未指定。",
  "3. 写作偏好无法从大纲、人物档案、既有正文推断（尺度、文风、题材处理方式）。",
  "4. 采集只存在于作者脑中的信息（一句话创意、既有构思、画面感）——用开放填空题（省略 options），不要替作者造候选。",
  "5. 动笔前需要一次确认一组关键设定（视角、节奏、命名候选等）——一次问完（≤2 问），不连环追问。",
  "",
  "## 何时不用",
  "1. 答案在大纲、人物/地点档案、既有正文里——先用相应 Read 工具查证，查完再决定要不要问。",
  "2. 答案可以枚举候选却用开放填空题（如「你想要什么结局？」）——空输入框锚定不了思路，能枚举必须给 2-4 个选项。",
  "3. 讨论型交流（「你觉得现在的大纲怎么样？」）——不构造选项也不求离散答案，直接在正文里说，一条回复只问一个问题。",
  "4. 写操作的放行确认——走审批门（requireApproval 工具自动征询），不要用本工具问「可以执行吗」。",
  "5. 可自行决断且代价可逆的细节（过渡方式、段落切分）——先写，作者不满意会改。",
  "6. 能基于既有设定/正文/工作流推断出合理方案的——先给建议方案并说明假设，不要用提问把功课推给作者。",
  "",
  "## 示例",
  "<example>",
  "作者：开始写第二卷吧",
  "→ NovelRead（kind=story_unit, includePlans=true）确认第二卷结构与进度",
  "→ AskUserQuestion（questions=[",
  "    {question:\"第二卷主线冲突升级走哪个方向？\", header:\"主线走向\", options:[",
  "      {label:\"外部势力正面压境（推荐）\", description:\"承接第一卷伏笔，冲突外化，动作场面多\"},",
  "      {label:\"阵营内部瓦解\", description:\"重心转权谋与信任崩塌，节奏更沉\"}]},",
  "    {question:\"新出场核心人物先立几个？\", header:\"人物节奏\", options:[",
  "      {label:\"1 个（推荐）\", description:\"集中笔墨，卷末再扩\"},",
  "      {label:\"2-3 个\", description:\"群像开场，信息密度高\"}]}])",
  "<reasoning>开卷前的真实分叉，选错浪费整卷写作量；两个问题一次问完，避免连环打断。</reasoning>",
  "</example>",
  "<example>",
  "作者：帮我开一本新书",
  "→ AskUserQuestion（questions=[",
  "    {question:\"用一句话说说你想写的故事（主角是谁 + 最想看的冲突）？\", header:\"一句话创意\",",
  "     placeholder:\"一句话：主角是谁 + 最想看的冲突\"},",
  "    {question:\"叙事视角？\", header:\"视角\", options:[",
  "      {label:\"第三人称有限（推荐）\", description:\"单视角贴身，最易保持悬念\"},",
  "      {label:\"第一人称\", description:\"代入感强，适合情绪流\"},",
  "      {label:\"多视角轮换\", description:\"群像与多线并行\"}]}])",
  "<reasoning>一句话创意只存在于作者脑中——开放填空不造候选，造了反而锚定作者思路；视角可枚举原型，给选项。</reasoning>",
  "</example>",
  "<example>",
  "（反例）作者：继续写下一个场景",
  "→ AskUserQuestion（questions=[{question:\"下一个场景写什么？\", ...}])",
  "<reasoning>下一个未完成场景可从大纲 progress 定位（NovelRead kind=story_unit），把能查证的功课推给作者是偷懒；先查再问。</reasoning>",
  "</example>",
  "",
  "## 字段细则",
  "- questions 1-4 个：问题文本完整、以问号结尾、互不重复；一次把该问的问完。跨轮派生式提问（由工作流驱动的逐步补充/逐步细化，每轮由前文派生新问题）不视为连环追问。",
  "- header ≤6 个汉字（UI 显示为芯片，如「主线走向」「视角」）。",
  "- context（可选，markdown）：问题上方的引导块——背景铺垫、灵感方向简述、示例；开放式创意题常用。",
  "- 选择题 options 2-4 个：label 简短（1-5 个词）、同问内不重复；description（markdown）说明含义与选中后的影响；不要设「其他」——UI 自动提供自由输入。候选多于 4 个时精选最可能的 ≤4 个：不要为穷举超限，更不要把别题的选项混入本题。「（推荐）」标记必须有前文依据（作者已给信息或既有设定）；冷启动问题（无上下文，如开书第一批）不带推荐。",
  "- 开放填空题（一句话创意、既有构思等）只有一个文本框：省略 options，**绝不配选项**——候选会把作者思路锚死；placeholder 是纯文本输入提示，与 options 互斥（选择题省略）。",
  "- multiSelect: true 用于素材/伏笔/支线取舍等选项不互斥的场景。",
  "- 返回作者的逐问回答（选择/自填/跳过）；跳过 = 作者授权你自行决断，不要重复追问。",
  "",
  "先查再问；能推断就不问；问了就按答案走，不重复问。",
].join("\n");

/** 提问请求序号（conversationId 作用域内递增；子进程重启后旧条目已被 CMS 标记过期，不冲突） */
let askSeq = 0;

/**
 * 创建 AskUserQuestion 工具（handler 闭包 ask 通道 + conversationId）
 * @param ask 提问通道（conv.sendAskingQuestionRequest 闭包；缺省回未送达文本）
 * @param conversationId 会话 id（requestId 组成）
 * @returns AskUserQuestion 工具定义
 */
export function createAskUserTool(ask: AskUserChannel | undefined, conversationId: string): ToolDef {
	return {
		name: "AskUserQuestion",
		version: "1.0.0",
		preview: askUserPreview,
		description: ASK_USER_QUESTION_DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				questions: {
					type: "array",
					minItems: 1,
					maxItems: 4,
					description:
						"要问作者的问题（1-4 个，可混排选择题与开放填空题）；一次把该问的问完，不连环追问",
					items: {
						type: "object",
						properties: {
							question: {
								type: "string",
								description:
									'完整问题，清晰具体、以问号结尾。例："第二卷主线冲突升级走哪个方向？"',
							},
							header: {
								type: "string",
								description: "极短标签（≤6 个汉字），UI 显示为芯片。例：「主线走向」「视角」",
							},
							context: {
								type: "string",
								description:
									"markdown 引导块（问题上方渲染）：背景铺垫、灵感方向简述、示例。开放式创意题常用",
							},
							options: {
								type: "array",
								minItems: 2,
								maxItems: 4,
								description:
									"候选选项（2-4 个，彼此互斥除非 multiSelect）；省略整个字段 = 开放填空题（答案只在作者脑中时用，如一句话创意）。不要设「其他」选项——UI 自动提供自由输入",
								items: {
									type: "object",
									properties: {
										label: {
											type: "string",
											description:
												"选项显示文本（1-5 个词）；推荐项放第一位并在末尾加「（推荐）」",
										},
										description: {
											type: "string",
											description: "选项含义 / 选中后的影响（markdown，可说明取舍）",
										},
									},
									required: ["label", "description"],
									additionalProperties: false,
								},
							},
							placeholder: {
								type: "string",
								description:
									"开放填空题的输入提示（纯文本，仅开放填空题可用；选择题省略）。例：「一句话：主角是谁 + 最想看的冲突」",
							},
							multiSelect: {
								type: "boolean",
								description: "true 时允许多选（素材/伏笔/支线取舍等选项不互斥场景）；默认 false",
							},
						},
						required: ["question", "header"],
						additionalProperties: false,
					},
				},
			},
			required: ["questions"],
			additionalProperties: false,
		},
		promptDetail: {
			policy: "",
			guidance: "",
		},
		handler: {
			execute: async (call) => {
				const { questions: rawQuestions } = parseArgs(call);
				if (rawQuestions.length < 1 || rawQuestions.length > 4) {
					throw new ToolError(
						{ code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
						`questions 必须是 1-4 个（收到 ${rawQuestions.length} 个）`,
					);
				}
				const specs = rawQuestions.map((q, i) => toQuestionSpec(q, i));
				if (ask === undefined) {
					return [
						"提问未送达作者：本会话未装配提问通道。",
						"不要重试本工具；基于已有信息继续，或改为在正文里说明需要作者补充什么。",
					].join("\n");
				}
				const requestId: RequestId = `ask:${conversationId}:${++askSeq}`;
				const answers = await ask({ requestId, questions: specs });
				const answered = answers.filter((a) => a.skipped !== true);
				if (answered.length === 0) {
					return [
						`作者跳过了全部问题（共 ${specs.length} 问）。`,
						"基于现有信息自行决断并继续；如缺关键信息，明说你的假设后再动笔，不要重复追问。",
					].join("\n");
				}
				const lines = answers.map((a) =>
					formatAnswer(specs.find((s) => s.question === a.question), a),
				);
				const skipped = answers.length - answered.length;
				return [
					`作者已作答（${answered.length}/${answers.length} 问${skipped > 0 ? `，${skipped} 问跳过` : ""}）：`,
					...lines,
				].join("\n");
			},
		},
	};
}
