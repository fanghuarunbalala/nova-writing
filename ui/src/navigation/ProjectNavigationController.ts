/** Coordinates local project-section navigation between Shell Meta and Inspector. */
import type { ProjectNavigationItem } from "../shell/index.js";
import type { ApplicationShellStore } from "../state/index.js";
import type { InspectorSize, InspectorStore, InspectorTarget } from "../inspector/index.js";

export type ProjectSectionNavigationItem = Exclude<
  ProjectNavigationItem,
  "new-conversation"
>;

export type ProjectNavigationResult =
  | { readonly status: "opened"; readonly target: InspectorTarget }
  | { readonly status: "unsupported"; readonly item: "new-conversation" };

export interface ProjectNavigationControllerOptions {
  readonly shellStore: ApplicationShellStore;
  readonly inspectorStore: InspectorStore;
}

interface ProjectSectionDescriptor {
  readonly kind: string;
  readonly label: string;
  readonly size: Exclude<InspectorSize, "closed">;
  readonly requiresNovel: boolean;
  readonly unavailableCode?: string;
}

const PROJECT_SECTIONS: Readonly<Record<ProjectSectionNavigationItem, ProjectSectionDescriptor>> =
  Object.freeze({
    schedule: Object.freeze({
      kind: "schedule",
      label: "安排",
      size: "normal",
      requiresNovel: false,
      unavailableCode: "SCHEDULE_PROTOCOL_UNRESOLVED",
    }),
    outline: Object.freeze({
      kind: "story-outline",
      label: "大纲",
      size: "expanded",
      requiresNovel: true,
    }),
    characters: Object.freeze({
      kind: "character-index",
      label: "人物",
      size: "normal",
      requiresNovel: true,
    }),
    locations: Object.freeze({
      kind: "location-index",
      label: "地点",
      size: "normal",
      requiresNovel: true,
    }),
    manuscript: Object.freeze({
      kind: "manuscript-index",
      label: "正文",
      size: "expanded",
      requiresNovel: true,
    }),
  });

export class ProjectNavigationController {
  private readonly shellStore: ApplicationShellStore;
  private readonly inspectorStore: InspectorStore;

  constructor(options: ProjectNavigationControllerOptions) {
    this.shellStore = options.shellStore;
    this.inspectorStore = options.inspectorStore;
  }

  navigate(item: ProjectNavigationItem): ProjectNavigationResult {
    if (item === "new-conversation") {
      return Object.freeze({ status: "unsupported", item });
    }
    const descriptor = PROJECT_SECTIONS[item];
    const shell = this.shellStore.getSnapshot();
    const novelId = shell.novel?.id;
    const scopeIdentity = novelId ?? "unbound";
    const target = Object.freeze({
      key: `${descriptor.kind}:${scopeIdentity}`,
      kind: descriptor.kind,
      title: descriptor.label,
      ...(novelId !== undefined
        ? { parameters: Object.freeze({ novelId }) }
        : {}),
    });
    this.shellStore.setMeta({
      id: target.key,
      kind: target.kind,
      label: target.title,
    });
    this.inspectorStore.openRoot(target, descriptor.size);
    if (descriptor.unavailableCode !== undefined) {
      this.inspectorStore.markUnavailable(target.key, descriptor.unavailableCode);
    } else if (descriptor.requiresNovel && novelId === undefined) {
      this.inspectorStore.markUnavailable(target.key, "NOVEL_NOT_SELECTED");
    }
    return Object.freeze({ status: "opened", target });
  }
}
