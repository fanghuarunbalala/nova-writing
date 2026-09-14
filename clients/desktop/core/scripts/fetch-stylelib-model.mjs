// 拉取嵌入模型（onnx-community/bge-small-zh-v1.5-ONNX q8，约 24MB）到
// core/resources/models/bge-small-zh-v1.5-ONNX/（gitignored——模型不入库，
// 同 training/models 惯例；copy-resources.mjs 构建时随 resources/ 拷入 dist）。
// 镜像：HF_ENDPOINT=https://hf-mirror.com node scripts/fetch-stylelib-model.mjs
// 强制重下：FORCED=1。已存在文件默认跳过。
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REPO = "onnx-community/bge-small-zh-v1.5-ONNX";
// q8 量化权重（model_quantized.onnx + 外置 data）+ transformers.js 所需 tokenizer/config
// （该仓库无 special_tokens_map.json——tokenizer.json 已内含全量词表）
const FILES = [
	"config.json",
	"tokenizer.json",
	"tokenizer_config.json",
	"onnx/model_quantized.onnx",
	"onnx/model_quantized.onnx_data",
];
const endpoint = (process.env.HF_ENDPOINT ?? "https://huggingface.co").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const destDir = join(scriptDir, "..", "resources", "models", "bge-small-zh-v1.5-ONNX");

const exists = async (path) => {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
};

for (const file of FILES) {
	const url = `${endpoint}/${REPO}/resolve/main/${file}`;
	const dest = join(destDir, file);
	if (process.env.FORCED !== "1" && (await exists(dest))) {
		console.log(`[fetch-stylelib-model] skip ${file}（已存在；FORCED=1 强制重下）`);
		continue;
	}
	await mkdir(dirname(dest), { recursive: true });
	console.log(`[fetch-stylelib-model] ${url} -> ${dest}`);
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`下载失败 HTTP ${response.status}：${url}`);
	}
	const tmp = `${dest}.tmp`;
	await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp));
	await rename(tmp, dest);
}
console.log(`[fetch-stylelib-model] done -> ${destDir}`);
