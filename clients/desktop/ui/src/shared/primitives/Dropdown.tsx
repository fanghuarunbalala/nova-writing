/**
 * Dropdown
 *
 * 基于 @radix-ui/react-dropdown-menu 的菜单：trigger 任意节点，
 * children 为 DropdownItem / DropdownSeparator 列表。
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import styles from "./Dropdown.module.css";

export interface DropdownProps {
  readonly trigger: ReactNode;
  readonly children: ReactNode; // DropdownItem 列表
  readonly align?: "start" | "center" | "end";
  readonly side?: "top" | "right" | "bottom" | "left";
}

export function Dropdown({ trigger, children, align = "end", side = "bottom" }: DropdownProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.content} align={align} side={side} sideOffset={6}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export interface DropdownItemProps {
  readonly icon?: ReactNode;
  readonly label: ReactNode;
  readonly onSelect: () => void;
  readonly danger?: boolean;
  readonly disabled?: boolean;
}

export function DropdownItem({ icon, label, onSelect, danger = false, disabled = false }: DropdownItemProps) {
  return (
    <DropdownMenu.Item
      className={[styles.item, danger ? styles.danger : ""].filter(Boolean).join(" ")}
      onSelect={onSelect}
      disabled={disabled}
    >
      {icon}
      <span>{label}</span>
    </DropdownMenu.Item>
  );
}

export function DropdownSeparator() {
  return <DropdownMenu.Separator className={styles.separator} />;
}
