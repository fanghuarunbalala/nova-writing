/**
 * NewConversationSection
 *
 * 新建对话 section。
 */
import { NewConversationButton } from "../../../domains/conversation/components/NewConversationButton.js";

export interface NewConversationSectionProps {
  readonly onCreate: () => void;
  readonly disabled?: boolean;
}

export function NewConversationSection({ onCreate, disabled = false }: NewConversationSectionProps) {
  return (
    <div style={{ padding: "12px 12px 6px" }}>
      <NewConversationButton onClick={onCreate} disabled={disabled} />
    </div>
  );
}
