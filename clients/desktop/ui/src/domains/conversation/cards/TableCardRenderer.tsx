/**
 * TableCardRenderer
 *
 * table 卡片：表头 + 富文本单元格。
 */
import type { TableCardContent } from "../projection/ConversationCardDescriptor.js";
import type { ConversationCardRenderer } from "./ConversationCardRendererRegistry.js";
import { RichTextRenderer } from "./RichTextRenderer.js";
import styles from "./TableCardRenderer.module.css";

export interface TableCardRendererProps {
  readonly card: { readonly kind: "table"; readonly id: string; readonly content: TableCardContent };
  readonly onAction?: (action: string, payload?: unknown) => void;
}

export function TableCardRenderer({ card, onAction }: TableCardRendererProps) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {card.content.headers.map((header, index) => (
            <th key={index} className={styles.header}>
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {card.content.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex} className={styles.cell}>
                <RichTextRenderer
                  richText={cell}
                  onReference={(reference) => onAction?.("reference", reference)}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const TableCardRendererObject: ConversationCardRenderer<{
  kind: "table";
  id: string;
  content: TableCardContent;
}> = {
  kind: "table",
  render: ({ card, onAction }) => <TableCardRenderer card={card} onAction={onAction} />,
};
