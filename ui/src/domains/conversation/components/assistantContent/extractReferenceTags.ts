/**
 * 抽取 assistant 正文中的实体引用标签，并清理未知/未闭合标签。
 * Extracts entity-reference tags from assistant text and strips unknown or
 * unclosed tags (keeping their inner text).
 *
 * 规则 / Rules（对齐 novel.system 输出约定）：
 * - 闭合的 <character|location|outline|paragraph id="x">名</…> 替换为 markdown
 *   链接 token [__ref__](cc://{kind}/{id}/{label})；
 * - 未知或未闭合的类 HTML 标签：剥离 <...> 标记，保留内部文本。
 */

const REF_TAG_PATTERN =
  /<(character|location|outline|paragraph)\s+id="([^"]+)">([^<]*)<\/\1>/g;

/** 类 HTML 标签（用于剥离未知/未闭合标签标记）。HTML-like tags to strip. */
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^<>]*)?>/g;

export const REFERENCE_LINK_TEXT = "ref";

export function extractReferenceTags(text: string): string {
  const withTokens = text.replace(
    REF_TAG_PATTERN,
    (_match, kind: string, id: string, label: string) =>
      `[${REFERENCE_LINK_TEXT}](cc://${kind}/${id}/${encodeURIComponent(label || id)})`,
  );
  return withTokens.replace(HTML_TAG_PATTERN, "");
}
