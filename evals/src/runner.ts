/**
 * Runner：单次评测执行（docs/PRD/eval-harness.md §7）。
 * 每次调用独立装配——临时 workspace + 全新 InMemoryNovelStore 种子写入 + 审批/提问通道闭包，
 * 无跨 case / 跨次污染；事件流经 MetricsCollector 采集，run 后物化终态快照。
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname, join, relative, sep } from "node:path";
import {
	buildNovelAgent,
	createProvider,
	InMemoryNovelStore,
} from "@novel/core";
import type {
	LoopEvent,
	ConversationApprovalDecision,
	ConversationApprovalRequest,
	ConversationAskingRequest,
	NovelHandle,
	Provider,
	ProviderConfig,
} from "@novel/core";
import { MetricsCollector, reduceMetrics } from "./collector.js";
import type { EvalInput, EvalRunMetrics, NovelStoreSnapshot } from "./types.js";

/** 注入点：密闭自测用 stub provider / 固定 workspace；缺省真实 DeepSeek + 临时目录 */
export interface RunAgentOptions {
	provider?: Provider;
	/** 提供时不建临时目录、run 后不清理（自测检视终态文件用） */
	workspaceDir?: string;
}

/** eval 用 provider 配置：DeepSeek（OpenAI 兼容），key 经环境注入 */
export function resolveEvalProviderConfig(): ProviderConfig {
	const apiKey =
		process.env.NOVEL_EVAL_API_KEY ??
		process.env.NOVEL_PROVIDER_API_KEY ??
		process.env.ANTHROPIC_AUTH_TOKEN;
	if (!apiKey) {
		throw new Error(
			"缺少 API key：设置 NOVEL_EVAL_API_KEY（或回退 NOVEL_PROVIDER_API_KEY / ANTHROPIC_AUTH_TOKEN）",
		);
	}
	return {
		id: "eval",
		type: "openai",
		baseUrl: process.env.NOVEL_EVAL_BASE_URL ?? "https://api.deepseek.com/v1",
		apiKey,
	};
}

async function snapshotStore(store: InMemoryNovelStore): Promise<NovelStoreSnapshot> {
	const get = async (q: unknown): Promise<unknown> => {
		try {
			return await store.query(q as never);
		} catch (e) {
			return { __error: e instanceof Error ? e.message : String(e) };
		}
	};
	return {
		overview: await get({ op: "overview.get" }),
		characters: await get({ op: "characters.list" }),
		locations: await get({ op: "locations.list" }),
		paragraphs: await get({ op: "paragraphs.list" }),
		outline: await get({ op: "outline.get", includePlans: true }),
		publication: await get({ op: "publication.get" }),
	};
}

async function readWorkspaceFiles(root: string): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	async function walk(dir: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const p = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(p);
			} else if (entry.isFile()) {
				try {
					const rel = relative(root, p).split(sep).join("/");
					out[rel] = await readFile(p, "utf8");
				} catch {
					// 单文件读取失败不拖垮整体快照
				}
			}
		}
	}
	await walk(root);
	return out;
}

/** 执行一次（单 repeat）：装配 → 跑任务（多条消息顺序 run，自动排队）→ 采集归约 → 物化终态 */
export async function runAgent(
	input: EvalInput,
	opts: RunAgentOptions = {},
): Promise<EvalRunMetrics> {
	const startedAt = Date.now();
	const workspace = opts.workspaceDir ?? (await mkdtemp(join(tmpdir(), "novel-eval-")));
	const ownsWorkspace = opts.workspaceDir === undefined;

	for (const [path, content] of Object.entries(input.seed?.files ?? {})) {
		await mkdir(dirname(join(workspace, path)), { recursive: true });
		await writeFile(join(workspace, path), content, "utf8");
	}

	const store = new InMemoryNovelStore();
	const seedMutations = input.seed?.novel;
	if (seedMutations !== undefined && seedMutations.length > 0) {
		await store.mutateBatch(seedMutations);
	}
	const handle = {
		query: (q: unknown) => store.query(q as never),
		mutate: (m: unknown) => store.mutate(m as never),
		mutateBatch: (ms: readonly unknown[]) =>
			store.mutateBatch(ms as never[]) as unknown as Promise<unknown[]>,
	} as unknown as NovelHandle;

	const provider = opts.provider ?? createProvider(resolveEvalProviderConfig());
	const sampling = {
		model: process.env.NOVEL_EVAL_MODEL ?? "deepseek-v4-flash",
		temperature: 0,
		...input.sampling,
	};
	const maxTurns = input.budget?.maxTurns ?? 30;
	const timeoutMs = input.budget?.timeoutMs ?? 300_000;

	const approvals = input.approvals;
	const requestApproval = async (
		req: ConversationApprovalRequest,
	): Promise<ConversationApprovalDecision> => {
		if (approvals !== undefined && approvals !== "auto") {
			if (req.toolCalls.some((tc) => approvals.deny.includes(tc.toolName))) {
				return { kind: "reject" };
			}
		}
		return { kind: "approve" };
	};

	const askScript = input.askScript ?? [];
	let askConsumed = 0;
	const requestAsk = async (req: ConversationAskingRequest) => {
		const answers = req.questions.map((spec) => {
			const scripted = askScript[askConsumed++];
			if (scripted === undefined) {
				return { question: spec.question, selections: [], skipped: true };
			}
			return { ...scripted, question: spec.question };
		});
		return answers;
	};

	const loop = buildNovelAgent({
		workspace,
		provider,
		handle,
		conversationId: `eval-${randomUUID()}`,
		requestApproval,
		requestAsk,
	});
	// 错误码推断需要「工具名在册」清单（沿既有测试 cast 先例读私有装配）
	const knownNames = new Set(
		(
			loop as unknown as {
				config: { agentCapability: { toolDefs: Array<{ name: string }> } };
			}
		).config.agentCapability.toolDefs.map((t) => t.name),
	);

	const collector = new MetricsCollector();
	const onEvent = (e: LoopEvent): void => collector.push(e, Date.now());
	const messages = Array.isArray(input.task) ? input.task : [input.task];

	const usage = { inputTokens: 0, outputTokens: 0 };
	let final = "";
	let ok = true;
	let runError: string | undefined;

	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			(async () => {
				for (const msg of messages) {
					const result = await loop.run(msg, { sampling, maxTurns }, onEvent);
					usage.inputTokens += result.usage?.inputTokens ?? 0;
					usage.outputTokens += result.usage?.outputTokens ?? 0;
					final = result.final.content;
				}
			})(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					loop.stop();
					reject(new Error(`eval 超时（>${timeoutMs}ms）`));
				}, timeoutMs);
			}),
		]);
	} catch (e) {
		ok = false;
		runError = e instanceof Error ? e.message : String(e);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}

	const reduced = reduceMetrics(collector.records, knownNames);
	const storeSnapshot = await snapshotStore(store);
	const files = await readWorkspaceFiles(workspace);
	if (ownsWorkspace) {
		await rm(workspace, { recursive: true, force: true }).catch(() => {});
	}

	return {
		ok,
		...(runError !== undefined ? { error: runError } : {}),
		turns: reduced.turns,
		toolCalls: reduced.toolCalls,
		toolErrors: reduced.toolErrors,
		usage,
		times: { totalMs: Date.now() - startedAt, perTurnMs: reduced.perTurnMs },
		final,
		storeSnapshot,
		files,
	};
}
