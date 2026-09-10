/**
 * RichTextRenderer
 *
 * 渲染 RichText 节点树：粗体/高亮/代码/引用 chip。
 */
import type { RichText } from "../projection/ConversationCardDescriptor.js";
import styles from "./RichTextRenderer.module.css";

export interface RichTextReference {
  readonly refKind: "character" | "location" | "outline";
  readonly id: string;
  readonly label: string;
}

export interface RichTextRendererProps {
  readonly richText: RichText;
  readonly onReference?: (reference: RichTextReference) => void;
}

export function RichTextRenderer({ richText, onReference }: RichTextRendererProps) {
  switch (richText.kind) {
    case "text":
      return <>{richText.text}</>;
    case "bold":
      return <strong>{richText.children.map((child, index) => <RichTextRenderer key={index} richText={child} onReference={onReference} />)}</strong>;
    case "highlight":
      return <mark className={styles.highlight}>{richText.children.map((child, index) => <RichTextRenderer key={index} richText={child} onReference={onReference} />)}</mark>;
    case "code":
      return <code className={styles.code}>{richText.text}</code>;
    case "reference": {
      const reference: RichTextReference = {
        refKind: richText.refKind,
        id: richText.id,
        label: richText.label,
      };
      return (
        <button
          type="button"
          className={styles.reference}
          onClick={() => onReference?.(reference)}
          title={reference.label}
        >
          {reference.label}
        </button>
      );
    }
  }
}
