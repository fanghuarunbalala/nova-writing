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
    <Button variant="secondary" size="sm" fullWidth leadingIcon={<Plus size={14} />} onClick={onClick} disabled={disabled}>
      新建对话
    </Button>
  );
}
