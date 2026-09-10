/**
 * novel 域键约定（对齐 legacy-main 契约）：
 * - 实体 id：客户端可自选（ID_PATTERN 校验），缺省宿主生成；重复即 duplicate_id。
 * - orderKey：4 位大写十六进制组（ORDER_KEY_PATTERN），模型传入须合规；
 *   缺省由宿主生成「末位兄弟的后继键」（字典序保持在其后）。
 */
import type { OrderKey } from "./model/outline.js";

/** 实体 id 约束（legacy 同款）：字母数字开头，可含 . _ : -，总长 1-160 */
export const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$";

/** orderKey 约束（legacy 同款）：4 位大写十六进制组，一组或多组 */
export const ORDER_KEY_PATTERN = "^(?:[0-9A-F]{4})+$";

/** orderKey 4 位组切分 */
const GROUP = /[0-9A-F]{4}/g;

/**
 * 生成末位兄弟的后继 orderKey（字典序严格大于 prev）：
 * - 无前驱 → "0001"；
 * - prev 合规（hex 组）→ 末组 < FFFF 自增、否则整体补一组 "0000"（前缀相等 + 更长 → 字典序更大）；
 * - prev 为存量时间戳等不合规键 → 追加 "0000"（仍严格在后；系统生成键不强制 pattern）。
 * @param prev 同兄弟集合内当前最大 orderKey（缺省无前驱）
 * @returns 后继 orderKey
 */
export function nextOrderKey(prev: string | undefined): OrderKey {
  if (prev === undefined || prev === "") return "0001" as OrderKey;
  if (new RegExp(ORDER_KEY_PATTERN).test(prev)) {
    const groups = prev.match(GROUP)!;
    const last = groups[groups.length - 1]!;
    if (last !== "FFFF") {
      groups[groups.length - 1] = (parseInt(last, 16) + 1).toString(16).toUpperCase().padStart(4, "0");
      return groups.join("") as OrderKey;
    }
    return (prev + "0000") as OrderKey;
  }
  return (prev + "0000") as OrderKey;
}
