/**
 * MainArea
 *
 * 主区路由 host：按 MainViewRouter 状态渲染 chat/content/schedule。
 */
import { useMainView } from "../../shared/routing/hooks.js";
import type { MainViewRouter } from "../../shared/routing/MainViewRouter.js";
import type { Logger, NovelApiClient } from "@novel/core";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import type { CharacterStore } from "../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { StoryOutlineTreeStore } from "../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import type { ScheduleStore } from "../../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../../domains/schedule/store/ScheduleTodoStore.js";
import { ChatSurface } from "./ChatSurface.js";
import { ContentSurface } from "./ContentSurface.js";
import { ScheduleSurface } from "./ScheduleSurface.js";
import styles from "./MainArea.module.css";

export interface MainAreaProps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
  readonly mainViewRouter: MainViewRouter;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly manuscript: ManuscriptStructureStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  readonly schedule: ScheduleStore;
  readonly scheduleTodo: ScheduleTodoStore;
  readonly onCreateConversation: () => void;
  readonly onSelectOutlineUnit?: (unitId: string) => void;
  readonly onSelectCharacter?: (characterId: string) => void;
  readonly onSelectLocation?: (locationId: string) => void;
  readonly onTodoAction?: (id: string, action: string) => void;
}

export function MainArea(props: MainAreaProps) {
  const mainView = useMainView(props.mainViewRouter);
  const workspaceId =
    props.conversationCatalog.getSnapshot().workspaceId ??
    props.outlineTree.getSnapshot().workspaceId;
  return (
    <main className={styles.main}>
      {mainView.state === "chat" ? (
        <ChatSurface
          api={props.api}
          logger={props.logger}
          conversationCatalog={props.conversationCatalog}
          onCreateConversation={props.onCreateConversation}
        />
      ) : mainView.state === "content" ? (
        <ContentSurface
          workspaceId={workspaceId}
          outlineTree={props.outlineTree}
          manuscript={props.manuscript}
          characters={props.characters}
          locations={props.locations}
          onSelectOutlineUnit={props.onSelectOutlineUnit}
          onSelectCharacter={props.onSelectCharacter}
          onSelectLocation={props.onSelectLocation}
        />
      ) : (
        <ScheduleSurface
          schedule={props.schedule}
          scheduleTodo={props.scheduleTodo}
          onTodoAction={props.onTodoAction}
        />
      )}
    </main>
  );
}
