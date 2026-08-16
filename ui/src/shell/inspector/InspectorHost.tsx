/**
 * InspectorHost
 *
 * 右侧 inspector（PRD AP-1/2）：恒挂载 + insp-head（kicker + close）+ insp-body。
 *
 * 与对话视图绑定（PRD AP-1）：visible=false（非 chat 视图）时按收起态呈现，
 * 路由状态保留——回到对话视图自动恢复。
 * 恒挂载：closed 时 aside 仍在 DOM（aria-hidden + inert + margin-right 收起），
 * 开合切换 .open class 触发过渡（非条件渲染）。
 * 宽度固定档位（决议 2）：>1280 = 376 / ≤1280 = 340 / ≤1080 右缘覆盖抽屉
 * （InspectorHost.module.css 媒体查询；拖拽调宽已移除）。
 * 审批已弹窗化（方案 A v0.8，demo app-redesign-demo）：inspector 不再渲染审批面板，
 * 本文件只承载 conversation 等档案类路由（P2 起内容目录为 chat 默认态）。
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
import { ConversationInspectorPanel } from "./panels/ConversationInspectorPanel.js";
import styles from "./InspectorHost.module.css";

const KICKER_BY_KIND: Record<string, string> = {
  conversation: "对话元信息",
};

/** 面板标题（原型 .insp-title，无 tab 切换，模式由入口决定）。 */
const TITLE_BY_KIND: Record<string, string> = {
  conversation: "对话元信息",
};

export interface InspectorHostProps {
  readonly inspectorRouter: InspectorRouter;
  /** 与对话视图绑定（PRD AP-1）：非 chat 视图按收起态呈现，路由状态保留。 */
  readonly visible?: boolean;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
}

/** 右侧档案面板宿主（memo：流式发布期间跳过，gui-performance-2 功能点五） */
export const InspectorHost = memo(function InspectorHost({
  inspectorRouter,
  visible = true,
  conversationCatalog,
  outlineTree: _outlineTree,
  characters: _characters,
  locations: _locations,
}: InspectorHostProps) {
  void _outlineTree;
  void _characters;
  void _locations;
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
            {route.state.kind === "conversation" ? (
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
