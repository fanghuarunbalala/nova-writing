/**
 * InspectorHost
 *
 * 右侧 inspector（PRD AP-1/2）：恒挂载 + insp-head（kicker + close）+ insp-body。
 *
 * 与对话视图绑定（PRD AP-1）：visible=false（非 chat 视图）时按收起态呈现，
 * 路由状态保留——回到对话视图自动恢复。
 * 恒挂载：closed 时 aside 仍在 DOM（aria-hidden + inert + margin-right 收起），
 * 开合切换 .open class 触发过渡（非条件渲染）。
 * 宽度固定档位（决议 2）：>1280 = 376 / ≤1280 = 340 / ≤1080 右缘覆盖抽屉。
 * directory = 对话视图默认态（内容目录，demo 方案 A v0.8）；
 * 审批已弹窗化：审批交互走 ApprovalModal，不走 inspector。
 */
import { memo } from "react";
import { X } from "lucide-react";
import { Icon } from "../../shared/primitives/Icon.js";
import { useInspectorRoute } from "../../shared/routing/hooks.js";
import type { InspectorRouter } from "../../shared/routing/InspectorRouter.js";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import type { CharacterStore } from "../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../domains/novel/location/store/LocationStore.js";
import type { StoryOutlineTreeStore } from "../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import { ContentDirectoryPanel } from "./panels/ContentDirectoryPanel.js";
import { ContentDirectoryStore } from "./ContentDirectoryStore.js";
import { ConversationInspectorPanel } from "./panels/ConversationInspectorPanel.js";
import styles from "./InspectorHost.module.css";

const KICKER_BY_KIND: Record<string, string> = {
  directory: "对话随手查 · 实体标签可定位",
  conversation: "对话元信息",
};

/** 面板标题（原型 .insp-title，无 tab 切换，模式由入口决定）。 */
const TITLE_BY_KIND: Record<string, string> = {
  directory: "内容目录",
  conversation: "对话元信息",
};

export interface InspectorHostProps {
  readonly inspectorRouter: InspectorRouter;
  /** 与对话视图绑定（PRD AP-1）：非 chat 视图按收起态呈现，路由状态保留。 */
  readonly visible?: boolean;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly contentDirectory: ContentDirectoryStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  /** 内容目录：大纲行点击 → 跳内容视图单元详情 */
  readonly onSelectOutlineUnit: (unitId: string) => void;
  /** 内容目录：详情卡「打开完整档案」→ 跳内容视图人物档案 */
  readonly onOpenCharacter: (characterId: string) => void;
  /** 内容目录：详情卡「打开完整档案」→ 跳内容视图地点档案 */
  readonly onOpenLocation: (locationId: string) => void;
}

/** 右侧面板宿主（memo：流式发布期间跳过，gui-performance-2 功能点五） */
export const InspectorHost = memo(function InspectorHost({
  inspectorRouter,
  visible = true,
  conversationCatalog,
  contentDirectory,
  outlineTree,
  characters,
  locations,
  onSelectOutlineUnit,
  onOpenCharacter,
  onOpenLocation,
}: InspectorHostProps) {
  const route = useInspectorRoute(inspectorRouter);
  // 恒挂载：closed 时 aside 仍在 DOM（aria-hidden + inert + margin-right 收起）。
  const open = route.state.kind !== "closed" && visible;

  const kicker = KICKER_BY_KIND[route.state.kind] ?? "详情";
  const title = TITLE_BY_KIND[route.state.kind] ?? "详情";
  return (
    <aside
      className={[styles.host, open ? styles.open : ""].filter(Boolean).join(" ")}
      aria-hidden={!open}
      inert={!open}
    >
      {open ? (
        <>
          <header className={styles.head}>
            <h3 className={styles.inspTitle}>{title}</h3>
            <span className={styles.kicker}>{kicker}</span>
            <button
              type="button"
              className={styles.close}
              aria-label="收起面板"
              onClick={() => inspectorRouter.close()}
            >
              <Icon icon={X} size="sm" />
            </button>
          </header>
          <div className={styles.body}>
            {route.state.kind === "directory" ? (
              <ContentDirectoryPanel
                store={contentDirectory}
                outlineTree={outlineTree}
                characters={characters}
                locations={locations}
                onSelectOutlineUnit={onSelectOutlineUnit}
                onOpenCharacter={onOpenCharacter}
                onOpenLocation={onOpenLocation}
              />
            ) : route.state.kind === "conversation" ? (
              <ConversationInspectorPanel
                conversationId={route.state.conversationId}
                conversationCatalog={conversationCatalog}
              />
            ) : (
              <div className={styles.pending}>详情面板待定</div>
            )}
          </div>
        </>
      ) : (
        <div className={styles.body} />
      )}
    </aside>
  );
});
