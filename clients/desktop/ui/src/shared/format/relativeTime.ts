/**
 * 相对时间格式化（对话目录副标题用，对齐 demo「刚刚 / 3 天前」文案）。
 * 粒度到天级即可（分组头为 今天/更早）：今天内 → 刚刚/N 分钟前/N 小时前；
 * 昨天 → 「昨天」；7 天内 → N 天前；更早 → YYYY-MM-DD。
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 格式化相对时间。
 * @param ms epoch ms（0 或未来时间视为未知 → 空串）
 * @param now 当前时间（缺省 Date.now()；测试注入）
 */
export function formatRelativeTime(ms: number, now: number = Date.now()): string {
	if (!Number.isFinite(ms) || ms <= 0 || ms > now) return "";
	const elapsed = now - ms;
	if (elapsed < MINUTE) return "刚刚";
	if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`;
	const startOfToday = new Date(now);
	startOfToday.setHours(0, 0, 0, 0);
	const todayMs = startOfToday.getTime();
	if (ms >= todayMs) return `${Math.floor(elapsed / HOUR)} 小时前`;
	// 天数按自然日零点对齐（8/13 任何时刻相对 8/15 都是 2 天前）
	const dayOf = new Date(ms);
	dayOf.setHours(0, 0, 0, 0);
	const daysAgo = Math.round((todayMs - dayOf.getTime()) / DAY);
	if (daysAgo === 1) return "昨天";
	if (daysAgo <= 7) return `${daysAgo} 天前`;
	const date = new Date(ms);
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}
