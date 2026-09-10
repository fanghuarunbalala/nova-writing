/**
 * 项目导入错误（code 供上层映射提示语义；消息面向用户）。
 */
export type ImportErrorCode =
	| "IMP_INVALID_ARGUMENT"
	| "IMP_IMPORT_FAILED"
	| "IMP_PROJECT_NOT_EMPTY"
	| "IMP_NOT_FOUND";

/** 项目导入错误 */
export class ImportError extends Error {
	/** 错误码 */
	readonly code: ImportErrorCode;

	/**
	 * @param code 错误码
	 * @param message 人读信息
	 */
	constructor(code: ImportErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}
