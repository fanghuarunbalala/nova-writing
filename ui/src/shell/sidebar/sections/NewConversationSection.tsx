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
    <div style={{ padding: "8px 10px 2px" }}>
      <NewConversationButton onClick={onCreate} disabled={disabled} />
    </div>
  );
}
