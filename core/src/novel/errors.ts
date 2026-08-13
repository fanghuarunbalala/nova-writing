/**
 * novel 域错误：revision 乐观锁冲突。
 */

/** 乐观锁冲突：baseRevision 与实体当前 entityVersion 不符（stale） */
export class NovelStaleRevisionError extends Error {
	/** 错误标识（自有可枚举字段，可跨 RPC 序列化保留；调用方按此判 stale——Error.name 跨 RPC 会丢） */
	readonly errorCode = "novel-stale";
	/** 实体当前版本 */
	readonly current: number;
	/** 请求携带的 baseRevision */
	readonly base: number;

	/**
	 * @param entityId 实体 id
	 * @param current 当前 entityVersion
	 * @param base 请求的 baseRevision
	 */
	constructor(entityId: string, current: number, base: number) {
		super(`revision 冲突（stale）：${entityId} 当前版本 ${current}，请求基于 ${base}`);
		this.name = "NovelStaleRevisionError";
		this.current = current;
		this.base = base;
	}
}
