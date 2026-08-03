/** Ordered immutable Prompt plan owned by an Agent Definition. */
import {
  PromptPlanItem,
  PromptSectionItem,
  type PromptPlanItemSnapshot,
} from "./PromptPlanItem.js";

export interface PromptRecipeSnapshot {
  readonly items: readonly PromptPlanItemSnapshot[];
}

export class PromptRecipe {
  readonly items: readonly PromptPlanItem[];

  constructor(items: readonly PromptPlanItem[]) {
    if (!Array.isArray(items) || items.length === 0 || items.length > 64) {
      throw new TypeError("Prompt Recipe items are invalid");
    }
    const sectionIds = new Set<string>();
    this.items = Object.freeze(
      [...items].map((item) => {
        if (!(item instanceof PromptPlanItem)) {
          throw new TypeError("Prompt Recipe item is invalid");
        }
        if (item instanceof PromptSectionItem) {
          const sectionId = item.sectionId;
          if (sectionIds.has(sectionId)) {
            throw new TypeError("Prompt Recipe Section IDs must be unique");
          }
          sectionIds.add(sectionId);
        }
        return item;
      }),
    );
    Object.freeze(this);
  }

  toSnapshot(): PromptRecipeSnapshot {
    return Object.freeze({
      items: Object.freeze(this.items.map((item) => item.toSnapshot())),
    });
  }
}
