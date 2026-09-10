/**
 * 输入 rpc 的持久化回执：事件落 journal 后返回。
 * 注意：回执是"已持久化（seq）"，不是"处理完成"；处理异步进行，产物走输出通道。
 */
export interface Receipt {
	/** journal 序列号 */
	seq: number
	/** 记录时间 */
	recordedAt: string
}
