/**
 * ConversationCardRendererRegistry
 *
 * 按卡片 kind 注册/查找渲染器；默认注册 6 个内置 renderer。
 */
import type { ReactNode } from "react";
import type { ConversationCardDescriptor } from "../projection/ConversationCardDescriptor.js";

export interface ConversationCardRenderer<
  C extends ConversationCardDescriptor = ConversationCardDescriptor,
> {
  readonly kind: C["kind"];
  render(props: {
    readonly card: C;
    readonly onAction?: (action: string, payload?: unknown) => void;
  }): ReactNode;
}

export class ConversationCardRendererRegistry {
  private readonly renderers = new Map<
    string,
    ConversationCardRenderer<ConversationCardDescriptor>
  >();

  register<C extends ConversationCardDescriptor>(renderer: ConversationCardRenderer<C>): void {
    this.renderers.set(
      renderer.kind,
      renderer as ConversationCardRenderer<ConversationCardDescriptor>,
    );
  }

  get(kind: string): ConversationCardRenderer | undefined {
    return this.renderers.get(kind);
  }

  has(kind: string): boolean {
    return this.renderers.has(kind);
  }
}
