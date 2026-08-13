/**
 * 抽取 assistant 正文中的实体引用标签，并清理未知/未闭合标签。
 * Extracts entity-reference tags from assistant text and strips unknown or
 * unclosed tags (keeping their inner text).
 *
 * 规则 / Rules（对齐 novel.system 输出约定）：
 * - 成对写法 <kind id="x">名</kind> 或 <kind id="x" name="别名">内文</kind>
 *   与自闭合写法 <kind id="x"/> / <kind id="x" name="别名"/> 替换为 markdown
 *   链接 token [ref](cc://{kind}/{id}/{label})；自闭合且无 name 时 label 为空，
 *   由渲染层从档案解析名字；
 * - 未知或未闭合的类 HTML 标签：剥离 <...> 标记，保留内部文本。
 */

const REF_KIND = "character|location|outline|chapter|paragraph";

/** 成对或自闭合引用标签；自闭合时 group 4 为空。 */
const REF_TAG_PATTERN = new RegExp(
  `<(${REF_KIND})\\s+id="([^"]+)"(?:\\s+name="([^"]*)")?\\s*(?:\\/>|>([^<]*)<\\/\\1>)`,
  "g",
);

/** 类 HTML 标签（用于剥离未知/未闭合标签标记）。HTML-like tags to strip. */
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^<>]*)?>/g;

export const REFERENCE_LINK_TEXT = "ref";

export function extractReferenceTags(text: string): string {
  const withTokens = text.replace(
    REF_TAG_PATTERN,
    (_match, kind: string, id: string, name: string | undefined, inner: string | undefined) => {
      const label = name !== undefined && name !== "" ? name : (inner ?? "");
      return `[${REFERENCE_LINK_TEXT}](cc://${kind}/${id}/${encodeURIComponent(label)})`;
    },
  );
  return withTokens.replace(HTML_TAG_PATTERN, "");
}
