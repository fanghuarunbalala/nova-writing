/**
 * 嵌入提供者抽象（PRD F2）：本地 ONNX（@huggingface/transformers +
 * onnx-community/bge-small-zh-v1.5-ONNX q8）懒加载单例；模型文件不入库
 * （scripts/fetch-stylelib-model.mjs 拉取到 gitignored resources/models/，
 * 同 training/models 惯例），运行时自模块目录上探解析 + env 覆盖
 * （agentCases 同款）。模型缺失 → create 返回 undefined，检索降级纯关键字路。
 */
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 嵌入维度（bge-small-zh-v1.5 = 512；stylelib.emb 行宽契约） */
export const EMBED_DIM = 512;

/** 嵌入提供者：texts → L2 归一化向量（维度恒 EMBED_DIM） */
export interface EmbeddingProvider {
	embed(texts: readonly string[]): Promise<Float32Array[]>;
}

/** 模型目录名（resources/models/ 下） */
const MODEL_DIR_NAME = "bge-small-zh-v1.5-ONNX";

/** 模型目录上探层级（dist/node/... → resources/models 布局） */
const MODEL_SEARCH_DEPTH = 5;

/** 模型目录 env 覆盖（测试/定制用） */
const MODEL_DIR_ENV = "NOVEL_STYLELIB_MODEL_DIR";

/**
 * 解析嵌入模型目录：NOVEL_STYLELIB_MODEL_DIR env → 自模块目录向上找
 * resources/models/bge-small-zh-v1.5-ONNX（兼容 dist/ 与 src/ 两种布局）。
 * @returns 模型目录绝对路径；不可用返回 undefined（降级纯关键字检索）
 */
export async function resolveStylelibModelDir(): Promise<string | undefined> {
	const envDir = process.env[MODEL_DIR_ENV];
	if (envDir !== undefined && envDir.trim() !== "") return envDir.trim();
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let depth = 0; depth < MODEL_SEARCH_DEPTH; depth++) {
		const candidate = join(dir, "resources", "models", MODEL_DIR_NAME);
		try {
			if ((await stat(candidate)).isDirectory()) return candidate;
		} catch {
			// 不存在继续上探
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

/** transformers.js pipeline 的本地最小形状（隔离库类型；动态 import 按需加载） */
type FeatureExtractionPipeline = (
	texts: readonly string[],
	options: { pooling: "cls"; normalize: boolean },
) => Promise<{ tolist(): unknown[][] }>;

/**
 * ONNX 本地嵌入提供者（懒加载单例语义由调用方持有：每进程/会话建一次）。
 * q8 量化（model_quantized.onnx，约 24MB）；CLS pooling + L2 归一。
 */
export class OnnxEmbeddingProvider implements EmbeddingProvider {
	private pipeline: FeatureExtractionPipeline | undefined;

	private constructor(private readonly modelDir: string) {}

	/**
	 * 创建实例（模型目录不可用返回 undefined——调用方降级关键字检索）
	 * @returns 提供者；模型缺失 undefined
	 */
	static async create(): Promise<OnnxEmbeddingProvider | undefined> {
		const dir = await resolveStylelibModelDir();
		return dir === undefined ? undefined : new OnnxEmbeddingProvider(dir);
	}

	async embed(texts: readonly string[]): Promise<Float32Array[]> {
		if (texts.length === 0) return [];
		this.pipeline ??= await loadPipeline(this.modelDir);
		const output = await this.pipeline(texts, { pooling: "cls", normalize: true });
		const rows = output.tolist();
		return texts.map((_, i) => {
			const row = rows[i] ?? [];
			const vector = new Float32Array(EMBED_DIM);
			for (let d = 0; d < Math.min(row.length, EMBED_DIM); d++) {
				const value = row[d];
				vector[d] = typeof value === "number" ? value : 0;
			}
			return vector;
		});
	}
}

/** 动态加载 transformers.js pipeline（类型断言隔离：不把库类型带进编译期契约） */
async function loadPipeline(modelDir: string): Promise<FeatureExtractionPipeline> {
	const mod = (await import("@huggingface/transformers")) as unknown as {
		pipeline: (
			task: string,
			model: string,
			options?: Record<string, unknown>,
		) => Promise<unknown>;
	};
	const extractor = await mod.pipeline("feature-extraction", modelDir, {
		dtype: "q8",
		device: "cpu",
	});
	return extractor as FeatureExtractionPipeline;
}

/**
 * 测试用确定性嵌入提供者：文本字符 hash → 单位向量（相似文本高余弦），
 * 零模型依赖（vitest 无网络/无 onnx 的纪律）。
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
	async embed(texts: readonly string[]): Promise<Float32Array[]> {
		return texts.map((text) => fakeVector(text));
	}
}

/** 确定性伪向量：每个字符在 hash 槽位累加后归一（公共字符多 → 余弦高） */
export function fakeVector(text: string): Float32Array {
	const vector = new Float32Array(EMBED_DIM);
	for (const char of text.slice(0, 256)) {
		const code = char.codePointAt(0) ?? 0;
		const idx = code % EMBED_DIM;
		vector[idx] = (vector[idx] ?? 0) + 1;
	}
	let norm = 0;
	for (const value of vector) norm += value * value;
	norm = Math.sqrt(norm);
	if (norm > 0) {
		for (let i = 0; i < vector.length; i++) vector[i] = (vector[i] ?? 0) / norm;
	}
	return vector;
}
