/**
 * NewConversationButton
 *
 * 新建对话按钮（对齐 demo .newConvBtn）：品牌渐变整宽主按钮。
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
      variant="primary"
      fullWidth
      className="novel-new-conv-btn"
      leadingIcon={<Plus size={14} />}
      onClick={onClick}
      disabled={disabled}
    >
      开始一段新的创作
    </Button>
  );
}
