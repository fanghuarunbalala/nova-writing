/**
 * 默认卡片 renderer 注册工厂。
 */
import { ConversationCardRendererRegistry } from "./ConversationCardRendererRegistry.js";
import { DiffCardRendererObject } from "./DiffCardRenderer.js";
import { PlanCardRendererObject } from "./PlanCardRenderer.js";
import { ProposalCardRendererObject } from "./ProposalCardRenderer.js";
import { QuoteCardRendererObject } from "./QuoteCardRenderer.js";
import { TableCardRendererObject } from "./TableCardRenderer.js";
import { TextCardRenderer } from "./TextCardRenderer.js";

export function createDefaultConversationCardRendererRegistry(): ConversationCardRendererRegistry {
  const registry = new ConversationCardRendererRegistry();
  registry.register(TextCardRenderer);
  registry.register(ProposalCardRendererObject);
  registry.register(DiffCardRendererObject);
  registry.register(TableCardRendererObject);
  registry.register(QuoteCardRendererObject);
  registry.register(PlanCardRendererObject);
  return registry;
}
