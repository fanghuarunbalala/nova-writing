/**
 * 引用解析器（Reference resolver）。
 * Reference resolver.
 *
 * 把消息中的实体引用（character/location/outline/chapter/paragraph）解析为
 * 档案名与"是否已建档"。自闭合引用（<kind id="x"/>）没有内文，显示名取这里；
 * known=false 用于 missing 虚线下划线态。数据来自各域 store 的当前快照。
 *
 * Resolves message entity references (character/location/outline/chapter/
 * paragraph) to an archive label and "known" flag. Self-closing references
 * (e.g. <kind id="x"/>) carry no inner text, so their display name comes from
 * here; known=false drives the missing dotted-underline state. Data is read
 * from the current snapshots of each domain store.
 */
import type { CharacterStore } from "../../novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../../novel/manuscript/store/ManuscriptStructureStore.js";
import type {
  StoryOutlineTreeNode,
} from "../../novel/outline/projection/StoryOutlineTreeProjection.js";
import type { StoryOutlineTreeStore } from "../../novel/outline/store/StoryOutlineTreeStore.js";
import type { MessageReference, ResolvedReference } from "../components/MessageReference.js";

export type ReferenceResolver = (
  reference: MessageReference,
) => ResolvedReference | undefined;

export interface DomainReferenceResolverDeps {
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  readonly outline: StoryOutlineTreeStore;
  readonly manuscript: ManuscriptStructureStore;
}

/** 从域 store 构建解析器。Builds a resolver from the domain stores. */
export function createDomainReferenceResolver(
  deps: DomainReferenceResolverDeps,
): ReferenceResolver {
  return (reference) => {
    switch (reference.refKind) {
      case "character": {
        const found = deps.characters
          .getSnapshot()
          .characters.find((item) => item.characterId === reference.id);
        return found === undefined
          ? { label: reference.label ?? reference.id, known: false }
          : { label: found.name, known: true };
      }
      case "location": {
        const found = deps.locations
          .getSnapshot()
          .locations.find((item) => item.locationId === reference.id);
        return found === undefined
          ? { label: reference.label ?? reference.id, known: false }
          : { label: found.name, known: true };
      }
      case "outline": {
        const found = findUnit(deps.outline.getSnapshot().tree, reference.id);
        return found === undefined
          ? { label: reference.label ?? reference.id, known: false }
          : { label: found.title, known: true };
      }
      case "chapter": {
        const found = deps.manuscript
          .getSnapshot()
          .chapters.find((item) => item.chapterId === reference.id);
        return found === undefined
          ? { label: reference.label ?? reference.id, known: false }
          : { label: found.title, known: true };
      }
      case "paragraph": {
        const found = deps.manuscript
          .getSnapshot()
          .chapters.some((chapter) =>
            chapter.blocks.some((block) => block.blockId === reference.id),
          );
        return found
          ? { label: reference.label ?? reference.id, known: true }
          : { label: reference.label ?? reference.id, known: false };
      }
    }
  };
}

function findUnit(
  nodes: readonly StoryOutlineTreeNode[],
  unitId: string,
): StoryOutlineTreeNode | undefined {
  for (const node of nodes) {
    if (node.unitId === unitId) return node;
    const found = findUnit(node.children, unitId);
    if (found !== undefined) return found;
  }
  return undefined;
}
