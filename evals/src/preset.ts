/**
 * 预置会话史（docs/PRD/evals-书库真实评测.md F6）：把「会话中途」作为起点——
 * 简化作者格式编译为 core LLMessage[]（经 buildNovelAgent 现成 runMessages 注入，
 * 预置内容不产生 provider 调用），配合 budget.maxTurns=1–5 即短跑模式。
 */
import type { AssistantMessage, LLMessage, ToolCall } from "@novel/core";

/** 简化作者格式（编译器自动生成 toolCallId 并配对 tool 结果） */
export type PresetEntry =
	| { role: "user"; content: string }
	| {
			role: "assistant";
			content?: string;
			toolCalls?: ReadonlyArray<{ name: string; args: unknown }>;
	  }
	| { role: "tool"; forCall: number; content: string };

/** raw LLMessage 判别（assistant.toolCalls 带 string id/args，tool 带 id） */
function isRawLlMessages(
	messages: ReadonlyArray<PresetEntry | LLMessage>,
): messages is ReadonlyArray<LLMessage> {
	return messages.every((m) => {
		const role = (m as { role?: unknown }).role;
		if (role === "user" || role === "system") return typeof (m as { content?: unknown }).content === "string";
		if (role === "assistant") {
			const toolCalls = (m as { toolCalls?: unknown }).toolCalls;
			return (
				typeof (m as { content?: unknown }).content === "string" &&
				(toolCalls === undefined ||
					(Array.isArray(toolCalls) &&
						toolCalls.every(
							(tc: unknown) =>
								typeof (tc as { id?: unknown }).id === "string" &&
								typeof (tc as { name?: unknown }).name === "string" &&
								typeof (tc as { args?: unknown }).args === "string",
						)))
			);
		}
		if (role === "tool") {
			return (
				typeof (m as { id?: unknown }).id === "string" &&
				(m as Record<string, unknown>).forCall === undefined
			);
		}
		return false;
	});
}

/**
 * 编译预置历史：preset 简化格式 → LLMessage[]（或 raw 直接透传校验）。
 * 校验：tool 结果必须指向前一条带 toolCalls 的 assistant（forCall 1 起序）；
 * assistant 的每个 toolCall 必须有配对结果（否则下一轮 provider call 缺 tool result 400）。
 */
export function compilePreset(
	messages: ReadonlyArray<PresetEntry | LLMessage>,
): LLMessage[] {
	if (isRawLlMessages(messages)) {
		return messages.map((m) => ({ ...(m as LLMessage) }));
	}
	const out: LLMessage[] = [];
	let pending: { message: AssistantMessage; calls: ToolCall[]; resolved: boolean[] } | null = null;
	let callSeq = 0;

	const flushPending = (context: string): void => {
		if (pending === null) return;
		if (pending.resolved.some((r) => !r)) {
			const missing = pending.resolved
				.map((r, i) => (r ? null : i + 1))
				.filter((v): v is number => v !== null);
			throw new Error(
				`preset 非法：${context}时 assistant 仍有未配对结果的 toolCall（第 ${missing.join(", ")} 个）`,
			);
		}
		pending = null;
	};

	for (const [i, entry] of messages.entries()) {
		const where = `第 ${i + 1} 条消息`;
		if (entry.role === "user") {
			flushPending(where);
			out.push({ role: "user", content: entry.content });
		} else if (entry.role === "assistant") {
			flushPending(where);
			const calls: ToolCall[] = (entry.toolCalls ?? []).map((tc) => ({
				id: `preset-call-${++callSeq}`,
				name: tc.name,
				args: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args),
			}));
			const message: AssistantMessage = {
				role: "assistant",
				content: entry.content ?? "",
				...(calls.length > 0 ? { toolCalls: calls } : {}),
			};
			out.push(message);
			if (calls.length > 0) {
				pending = { message, calls, resolved: calls.map(() => false) };
			}
		} else if (entry.role === "tool") {
			if (pending === null) {
				throw new Error(`preset 非法：${where}的 tool 结果没有前置的 assistant toolCall`);
			}
			const toolEntry = entry as { role: "tool"; forCall: number; content: string };
			const idx = toolEntry.forCall - 1;
			if (idx < 0 || idx >= pending.calls.length) {
				throw new Error(
					`preset 非法：${where}的 forCall=${toolEntry.forCall} 越界（前置 assistant 共 ${pending.calls.length} 个 toolCall）`,
				);
			}
			if (pending.resolved[idx]) {
				throw new Error(`preset 非法：${where}的 forCall=${toolEntry.forCall} 重复配对`);
			}
			pending.resolved[idx] = true;
			out.push({ role: "tool", content: toolEntry.content, id: pending.calls[idx]!.id });
			if (pending.resolved.every(Boolean)) pending = null;
		} else {
			throw new Error(`preset 非法：${where}的 role 无法识别（${String((entry as { role?: unknown }).role)}）`);
		}
	}
	flushPending("结尾");
	return out;
}
