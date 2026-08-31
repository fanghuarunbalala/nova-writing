/**
 * 本地嵌入器（PRD memory-两层记忆 D10 可选通道）：transformers.js 纯 JS+ONNX
 * 运行本地 bge-small-zh-v1.5（中英多语言，q8 量化）。中文网络环境 huggingface.co
 * 不可达是常态——因此本地通道为**显式开启**（NOVEL_MEMORY_LOCAL_EMBEDDINGS=1，
 * 镜像经 NOVEL_MEMORY_HF_MIRROR 配置，如 https://hf-mirror.com），设置页 API
 * 通道（Embedding profile）才是主通道；两者皆无 → 记忆检索纯 BM25 词法。
 *
 * 惰性动态 import（未启用不付加载成本）；加载/推理失败标记 failed 后不再重试，
 * 上层降级词法（记忆检索不可用不阻断任何主流程）。
 */
import { mkdir } from "node:fs/promises";
import type { Logger } from "../log/Logger.js";

/** 本地嵌入器选项 */
export interface LocalEmbedderOptions {
	/** 模型 id（HF 仓库名；缺省 Xenova/bge-small-zh-v1.5，q8 量化约 90MB） */
	readonly model?: string;
	/** HF 下载镜像（如 https://hf-mirror.com；缺省官方源） */
	readonly mirror?: string;
	/** 模型缓存目录（缺省 <cacheRoot>/models；首次使用时按需下载） */
	readonly cacheRoot?: string;
	readonly logger?: Logger;
}

/** 嵌入接口（与 Provider.embed 对齐，供混合检索统一消费） */
export interface Embedder {
	/** 批量嵌入：与 texts 等长同序；不可用时抛错（调用方降级词法） */
	embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
	/** 通道标识（缓存失效键之一：换通道换模型全量重嵌） */
	readonly modelId: string;
}

/** 默认本地模型（中英多语言小模型） */
export const LOCAL_EMBEDDING_DEFAULT_MODEL = "Xenova/bge-small-zh-v1.5";

/**
 * 创建本地嵌入器（惰性单例：首次 embed 才加载模型，进程内复用）。
 * 构造本身零成本（不 import transformers）；模型加载/推理失败 → 永久禁用并抛错。
 * @param options 模型/镜像/缓存目录
 * @returns Embedder
 */
export function createLocalEmbedder(options?: LocalEmbedderOptions): Embedder {
	const model = options?.model ?? LOCAL_EMBEDDING_DEFAULT_MODEL;
	/** 模型管线（惰性 memoized；failed 后恒 undefined） */
	let pipelinePromise: Promise<{
		extract: (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;
	}> | undefined;
	let failed = false;

	const loadPipeline = async () => {
		if (failed) throw new Error("local embedder disabled (previous failure)");
		pipelinePromise ??= (async () => {
			const transformers = await import("@huggingface/transformers");
			if (options?.mirror !== undefined && options.mirror.trim() !== "") {
				// 镜像必须先于任何模型请求设置（remoteHost 影响后续全部下载）
				transformers.env.remoteHost = options.mirror.trim().replace(/\/+$/, "");
			}
			if (options?.cacheRoot !== undefined) {
				await mkdir(options.cacheRoot, { recursive: true });
				transformers.env.cacheDir = options.cacheRoot;
			}
			const pipe = await transformers.pipeline("feature-extraction", model, {
				dtype: "q8",
			});
			return pipe as unknown as {
				extract: (
					texts: string[],
					opts: { pooling: "mean"; normalize: boolean },
				) => Promise<{ data: Float32Array; dims: number[] }>;
			};
		})().catch((error) => {
			failed = true;
			pipelinePromise = undefined;
			options?.logger?.warn("memory.local_embedder.load_failed", {
				model,
				failure: error instanceof Error ? error.message.slice(0, 200) : String(error),
			});
			throw error instanceof Error ? error : new Error(String(error));
		});
		return pipelinePromise;
	};

	return {
		modelId: `local:${model}`,
		async embed(texts) {
			if (texts.length === 0) return [];
			const pipe = await loadPipeline();
			const output = await pipe.extract(texts, { pooling: "mean", normalize: true });
			// 输出形状 [batch, seq→1(mean pooled), dim] 展平为 batch × dim
			const dims = output.dims;
			const dim = dims[dims.length - 1] ?? 0;
			if (dim === 0 || output.data.length !== texts.length * dim) {
				throw new Error(`local embedder 输出形状异常: ${JSON.stringify(dims)}`);
			}
			const vectors: number[][] = [];
			for (let i = 0; i < texts.length; i++) {
				vectors.push(Array.from(output.data.subarray(i * dim, (i + 1) * dim)));
			}
			return vectors;
		},
	};
}

/**
 * 从 env 解析本地嵌入器选项（未启用返回 undefined）：
 * - NOVEL_MEMORY_LOCAL_EMBEDDINGS=1 显式开启（中文网络下 huggingface.co 默认不可达，
 *   不做静默惊喜下载）
 * - NOVEL_MEMORY_HF_MIRROR 镜像（如 https://hf-mirror.com）
 * - NOVEL_MEMORY_EMBEDDING_MODEL 模型覆盖
 * - NOVEL_MEMORY_EMBEDDING_CACHE 缓存根目录（缺省 <storeDir>/models，调用方传入）
 */
export function localEmbedderFromEnv(env: {
	NOVEL_MEMORY_LOCAL_EMBEDDINGS?: string;
	NOVEL_MEMORY_HF_MIRROR?: string;
	NOVEL_MEMORY_EMBEDDING_MODEL?: string;
	NOVEL_MEMORY_EMBEDDING_CACHE?: string;
}, defaults?: { cacheRoot?: string; logger?: Logger }): LocalEmbedderOptions | undefined {
	if (!/^(1|true)$/i.test(env.NOVEL_MEMORY_LOCAL_EMBEDDINGS ?? "")) return undefined;
	return {
		...(env.NOVEL_MEMORY_EMBEDDING_MODEL !== undefined && env.NOVEL_MEMORY_EMBEDDING_MODEL !== ""
			? { model: env.NOVEL_MEMORY_EMBEDDING_MODEL }
			: {}),
		...(env.NOVEL_MEMORY_HF_MIRROR !== undefined && env.NOVEL_MEMORY_HF_MIRROR !== ""
			? { mirror: env.NOVEL_MEMORY_HF_MIRROR }
			: {}),
		cacheRoot: env.NOVEL_MEMORY_EMBEDDING_CACHE?.trim() || defaults?.cacheRoot,
		...(defaults?.logger !== undefined ? { logger: defaults.logger } : {}),
	};
}
