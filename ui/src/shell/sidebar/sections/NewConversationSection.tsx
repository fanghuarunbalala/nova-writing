/**
 * NewConversationSection
 *
 * 新建对话 section。
 */
import { NewConversationButton } from "../../../domains/conversation/components/NewConversationButton.js";
import styles from "./NewConversationSection.module.css";

export interface NewConversationSectionProps {
  readonly onCreate: () => void;
  readonly disabled?: boolean;
}

export function NewConversationSection({ onCreate, disabled = false }: NewConversationSectionProps) {
  return (
    <div className={styles.section}>
      <NewConversationButton onClick={onCreate} disabled={disabled} />
    </div>
  );
}
