/**
 * NewConversationButton
 *
 * 新建对话按钮。
 */
import { Button } from "../../../shared/primitives/Button.js";
import { Plus } from "lucide-react";

export interface NewConversationButtonProps {
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

export function NewConversationButton({ onClick, disabled = false }: NewConversationButtonProps) {
  return (
    <Button
      variant="secondary"
      size="sm"
      fullWidth
      className="novel-new-conv-btn"
      leadingIcon={<Plus size={14} />}
      onClick={onClick}
      disabled={disabled}
    >
      创建对话
    </Button>
  );
}
