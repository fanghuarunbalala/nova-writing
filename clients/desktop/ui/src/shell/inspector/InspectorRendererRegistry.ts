/**
 * InspectorRendererRegistry
 *
 * Inspector panel 注册表（spec 4.1）。让扩展点不依赖 InspectorHost 内的硬编码 switch；
 * 桌面端可注入桌面专属 inspector panel（如 desktop-runtime-status）。
 *
 * 状态：Phase A 前向声明 + 简单实现；InspectorHost 当前仍用硬编码 switch，
 * Phase 3 视觉打磨阶段再迁移到注册表驱动（见 spec 4.1 注释）。
 */
import type { ComponentType } from "react";
import type { InspectorState } from "../../shared/routing/InspectorRouter.js";

export interface InspectorRendererProps {
  /** 当前 workspace id；可能为 undefined（workspace 未激活时） */
  readonly workspaceId: string | undefined;
  /** 当前 inspector 路由状态；组件按 kind 区分消费 */
  readonly route: InspectorState;
}

export interface InspectorRendererEntry {
  /** 匹配 InspectorState.kind：'approval' | 'entity' | 'conversation' | 'outlineUnit' */
  readonly kind: string;
  readonly component: ComponentType<InspectorRendererProps>;
}

export class InspectorRendererRegistry {
  private readonly panels = new Map<string, ComponentType<InspectorRendererProps>>();

  register(entry: InspectorRendererEntry): void {
    this.panels.set(entry.kind, entry.component);
  }

  resolve(kind: string): ComponentType<InspectorRendererProps> | undefined {
    return this.panels.get(kind);
  }

  /** 返回所有已注册 kind，便于调试与测试 */
  listKinds(): readonly string[] {
    return Array.from(this.panels.keys());
  }
}
