/**
 * 项目导入存储布局（唯一事实源；ProjectImportService 之外不得自行拼接路径）。
 * 布局（与工作区 .novel/library.json、.novel/cases/ 同域）：
 *
 *   <workspaceRoot>/.novel/import/
 *     import.json            # 导入状态/统计（agent 收尾翻转 status）
 *     source/<原始文件名>     # UTF-8 归一原文（zip 拼接后的全文）
 *     paragraphs/imp-bNNNNNN.md     # 正文分批（agent 读取单元，批次粒度）
 *     paragraphs/manifest.jsonl
 *
 * novel.db 内 id 命名（批次与段落不同前缀，避免碰撞）：
 *   批次 id imp-bNNNNNN（= 批文件名，manifest 引用；进度信号游标）
 *   段落 id imp-pNNNNNN（每自然段一条 Paragraph）
 *   卷 id imp-vol-NN / 章 id imp-ch-NNNN / 段落锚点单元 id imp-anchor
 *   全书根 story unit id imp-saga（预建；ProjectImporter 的幕一律挂其下）
 */
import { join } from "node:path";

/** 导入目录（<workspaceRoot>/.novel/import） */
export function importDir(workspaceRoot: string): string {
	return join(workspaceRoot, ".novel", "import");
}

/** 原文目录 */
export function importSourceDir(workspaceRoot: string): string {
	return join(importDir(workspaceRoot), "source");
}

/** 分批目录 */
export function importParagraphsDir(workspaceRoot: string): string {
	return join(importDir(workspaceRoot), "paragraphs");
}

/** 批文件路径（paragraphs/<batchId>.md） */
export function batchFilePath(workspaceRoot: string, batchId: string): string {
	return join(importParagraphsDir(workspaceRoot), `${batchId}.md`);
}

/** manifest 路径（paragraphs/manifest.jsonl） */
export function importManifestPath(workspaceRoot: string): string {
	return join(importParagraphsDir(workspaceRoot), "manifest.jsonl");
}

/** 导入元数据路径（import.json） */
export function importMetaPath(workspaceRoot: string): string {
	return join(importDir(workspaceRoot), "import.json");
}

/** 批次 id（imp-b<6位序>；= 批文件名） */
export function batchIdOf(seq: number): string {
	return `imp-b${String(seq).padStart(6, "0")}`;
}

/** 段落 id（imp-p<6位序>；novel.db Paragraph 主键） */
export function paragraphIdOf(seq: number): string {
	return `imp-p${String(seq).padStart(6, "0")}`;
}

/** 段落锚点 story unit id（导入正文统一挂靠；大纲树由 ProjectImporter 构建） */
export const IMPORT_ANCHOR_UNIT_ID = "imp-anchor";

/** 锚点单元标题 */
export const IMPORT_ANCHOR_UNIT_TITLE = "导入稿件";

/** 全书根 story unit id（落库预建 scope=saga；ProjectImporter 的幕一律挂其下，杜绝游离顶层幕） */
export const IMPORT_SAGA_UNIT_ID = "imp-saga";
