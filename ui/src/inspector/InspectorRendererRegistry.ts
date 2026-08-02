/** Immutable registry mapping Inspector target kinds to shared React renderers. */
import type { ComponentType } from "react";
import type {
  InspectorContentSnapshot,
  InspectorTarget,
} from "./InspectorStore.js";

export interface InspectorRendererProps {
  readonly target: InspectorTarget;
  readonly content: InspectorContentSnapshot;
}

export type InspectorRenderer = ComponentType<InspectorRendererProps>;

export interface InspectorRendererRegistration {
  readonly kind: string;
  readonly renderer: InspectorRenderer;
}

export class InspectorRendererRegistry {
  private readonly renderers: ReadonlyMap<string, InspectorRenderer>;

  constructor(registrations: readonly InspectorRendererRegistration[] = []) {
    const renderers = new Map<string, InspectorRenderer>();
    for (const registration of registrations) {
      const kind = requireNonBlank(registration.kind, "Inspector renderer kind");
      if (renderers.has(kind)) {
        throw new TypeError("Inspector renderer kind must be unique");
      }
      renderers.set(kind, registration.renderer);
    }
    this.renderers = renderers;
  }

  resolve(kind: string): InspectorRenderer | undefined {
    return this.renderers.get(requireNonBlank(kind, "Inspector target kind"));
  }

  has(kind: string): boolean {
    return this.renderers.has(requireNonBlank(kind, "Inspector target kind"));
  }

  withRenderer(kind: string, renderer: InspectorRenderer): InspectorRendererRegistry {
    const normalizedKind = requireNonBlank(kind, "Inspector renderer kind");
    if (this.renderers.has(normalizedKind)) {
      throw new TypeError("Inspector renderer kind must be unique");
    }
    return new InspectorRendererRegistry([
      ...[...this.renderers].map(([registeredKind, registeredRenderer]) => ({
        kind: registeredKind,
        renderer: registeredRenderer,
      })),
      { kind: normalizedKind, renderer },
    ]);
  }
}

export const emptyInspectorRendererRegistry = new InspectorRendererRegistry();

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
  return value;
}
