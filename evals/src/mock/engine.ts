/**
 * mock 引擎（docs/PRD/evals-书库真实评测.md F3）：书库桩的服务层返回决策器。
 * 三态语义——静态查询（缺省，走夹具包数据）/ 脚本序列（按匹配器消耗响应队列，
 * 响应形态含错误注入）/ 状态演化（TS 状态函数 f(args, state, callIndex)，
 * 声明式 JSON 表达不了的逃生舱）。脚本耗尽回退静态并计 scriptExhausted。
 */
import { jsonSubset } from "../matcher.js";

/** LibraryRead 服务层方法（与 LibraryReadDeps 四方法对齐） */
export type LibraryMethod =
	| "listBooks"
	| "openBookStore"
	| "readParagraphs"
	| "readAnalysis";

/**
 * 脚本/状态响应形态：string = 该次调用的完整结果 JSON 文本（openBookStore 例外，
 * 其返回是 store 无法脚本化——字符串响应按错误注入处理）；{error} = 抛错（自愈类 case）。
 */
export type MockResponse =
	| string
	| { error: string }
	| ((
			args: Record<string, unknown>,
			state: Record<string, unknown>,
			callIndex: number,
	  ) => string | { error: string });

/** 一条 mock 规则：匹配器 + 按序消耗的响应队列 */
export interface LibraryMockEntry {
	/** method 相等且 argsSubset 为实参子集（jsonSubset 语义） */
	match: { method: LibraryMethod; argsSubset?: Record<string, unknown> };
	responses: ReadonlyArray<MockResponse>;
}

/** case 级 mock 脚本（EvalInput.library.mock；声明式 JSON 优先，状态函数为 TS 逃生舱） */
export interface LibraryMockScript {
	entries: ReadonlyArray<LibraryMockEntry>;
}

/** 服务层方法 → LibraryRead kind（呈现/断言用；readAnalysis 以 args.which 细分） */
export function methodKind(method: LibraryMethod, args: unknown): string {
	if (method === "listBooks") return "overview";
	if (method === "readParagraphs") return "paragraph";
	if (method === "readAnalysis") {
		const which = (args as { which?: unknown } | undefined)?.which;
		return which === "style" || which === "excerpt" ? which : "analysis";
	}
	return "entity";
}

/** 书库 mock 调用轨迹（metrics.libraryCalls；断言与引用信息边界共用） */
export interface LibraryCallTrace {
	callIndex: number;
	method: LibraryMethod;
	/** 派生 LibraryRead kind（entity = 实体类五 kind 统称） */
	kind: string;
	bookId?: string;
	/** 规整后的服务层实参（openBookStore → {bookId}；readAnalysis → {which, maxChars} 等） */
	args: Record<string, unknown>;
	/** 返回来源：static = 夹具静态 / script = 脚本队列 / state = 状态函数 */
	source: "static" | "script" | "state";
	/** 本次返回文本中出现的该书 paragraph id（「实际返回集合」的证据链） */
	returnedParagraphIds?: string[];
	/** 抛错（错误注入或访问控制）时的消息 */
	error?: string;
}

/** 调用记录器（每 run 一枚，随 metrics 物化） */
export class LibraryCallRecorder {
	readonly calls: LibraryCallTrace[] = [];

	record(trace: LibraryCallTrace): void {
		this.calls.push(trace);
	}
}

export type MockOutcome =
	| { kind: "miss" }
	| { kind: "exhausted" }
	| { kind: "hit"; source: "script" | "state"; response: string | { error: string } };

/** mock 决策器：per-entry 匹配 → 按序消耗；无脚本/未命中 → miss（走静态） */
export class MockEngine {
	/** 脚本耗尽回退静态的次数（metrics.scriptExhausted） */
	exhaustedCount = 0;
	private readonly state: Record<string, unknown> = {};
	private readonly consumed = new Map<number, number>();

	constructor(private readonly script?: LibraryMockScript) {}

	resolve(method: LibraryMethod, args: Record<string, unknown>, callIndex: number): MockOutcome {
		if (this.script === undefined) return { kind: "miss" };
		for (const [i, entry] of this.script.entries.entries()) {
			if (entry.match.method !== method) continue;
			if (
				entry.match.argsSubset !== undefined &&
				!jsonSubset(entry.match.argsSubset)(args, JSON.stringify(args))
			) {
				continue;
			}
			const used = this.consumed.get(i) ?? 0;
			let next: MockResponse | undefined = entry.responses[used];
			if (next === undefined) {
				// 状态函数常驻：队列末位是函数时耗尽后持续复用（状态演化的常驻形态）；
				// 字符串响应严格一次，耗尽即回退静态（计 scriptExhausted）。
				const last = entry.responses[entry.responses.length - 1];
				if (last !== undefined && typeof last === "function") {
					next = last;
				} else {
					this.exhaustedCount++;
					return { kind: "exhausted" };
				}
			}
			this.consumed.set(i, used + 1);
			if (typeof next === "function") {
				return { kind: "hit", source: "state", response: next(args, this.state, callIndex) };
			}
			return { kind: "hit", source: "script", response: next };
		}
		return { kind: "miss" };
	}
}
