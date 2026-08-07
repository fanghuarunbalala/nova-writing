/**
 * 在 child 进程内打开真实 Novel 工具注册表：直连 novel.sqlite（WAL 多进程），
 * 构造真实查询服务与 canonical writer，供 child 工具执行使用。
 * Opens the real Novel tool registry inside the child process: direct
 * novel.sqlite access (WAL multi-process) with real query services and the
 * canonical writer for tool execution.
 */
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { noopLogger, type Logger } from "../../../../observability/index.js";
import {
  CharacterQueryService,
  LocationQueryService,
  NovelOperationExecutor,
  ParagraphQueryService,
  PublicationQueryService,
  RandomStoryIdentityFactory,
  StoryOutlineQueryService,
  SystemNovelClock,
  captureCharacterId,
  captureLocationId,
  captureNovelOperationId,
  captureParagraphId,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolumeId,
  createDefaultNovelOperationRegistry,
  type CharacterId,
  type LocationId,
  type NovelMutationContext,
  type NovelOperationId,
  type ParagraphId,
  type PublicationChapterId,
  type PublicationStructureId,
  type PublicationVolumeId,
} from "../../../../novel/index.js";
import type { ConversationTodoWriter } from "../../../../runtime/todo/index.js";
import { ToolGroupCatalog } from "../../../../tooling/group/index.js";
import { loadToolGroupManifest } from "../../../../tooling/group/index.js";
import { ToolRegistry } from "../../../../tooling/registry/index.js";
import {
  NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
  NovelCharacterToolService,
  createNovelCharacterToolRegistry,
} from "../../../../tools/novel/index.js";
import {
  NOVEL_DELETE_TOOL_GROUP_MANIFEST,
  NovelDeleteToolService,
  createNovelDeleteToolRegistry,
} from "../../../../tools/novel/index.js";
import {
  NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
  NovelLocationToolService,
  createNovelLocationToolRegistry,
} from "../../../../tools/novel/index.js";
import {
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  OutlineToolService,
  createNovelOutlineToolRegistry,
} from "../../../../tools/novel/index.js";
import {
  NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST,
  NovelParagraphToolService,
  createNovelParagraphToolRegistry,
} from "../../../../tools/novel/index.js";
import {
  NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST,
  NovelPublicationToolService,
  createNovelPublicationToolRegistry,
} from "../../../../tools/novel/index.js";
import { createTodoToolRegistry } from "../../../../tools/todo/index.js";
import {
  NOVEL_COMPOSE_TOOL_GROUP_MANIFEST,
  ComposeToolService,
  createNovelComposeToolRegistry,
} from "../../../../tools/novel/index.js";
import {
  RUNTIME_FILES_TOOL_GROUP_MANIFEST,
  createFileToolRegistry,
} from "../../../../tools/files/index.js";
import { FileToolService } from "../../../../tools/files/index.js";
import { ComposeModeStateProvider } from "../../../../runtime/compose/index.js";
import type { RuntimeEventSink } from "../../../../runtime/execution/event/index.js";
import { NodeNovelStoreLocator } from "../../../novel/workspace/index.js";
import type { NodeNovelStoreLocation } from "../../../novel/workspace/index.js";
import {
  SqliteNovelCanonicalStore,
  SqliteNovelCanonicalWriter,
  SqliteNovelComposeCommitStore,
  SqliteNovelEntityQueryStore,
  SqliteNovelOutlineQueryStore,
  SqliteNovelParagraphQueryStore,
  SqliteNovelPublicationQueryStore,
  createSqliteNovelMutationContext,
} from "../../../novel/sqlite/index.js";
import { NodeWorkspaceStoreLocator } from "../../../workspace/index.js";

const RUNTIME_TODO_TOOL_GROUP_MANIFEST = `
schemaVersion: 1
id: runtime.todo
version: 1.0.0
label: Runtime todo tools
tools: [TodoWrite]
`;

export interface ChildNovelToolRegistryOptions {
  readonly storageRoot: string;
  readonly workdir: string;
  readonly todoWriter: ConversationTodoWriter;
  readonly composeState: ComposeModeStateProvider;
  readonly eventSink: RuntimeEventSink;
  readonly logger?: Logger;
}

export interface CreateChildNovelToolRegistryOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: import("../../../../novel/index.js").NovelId;
  readonly todoWriter: ConversationTodoWriter;
  readonly composeState: ComposeModeStateProvider;
  readonly eventSink: RuntimeEventSink;
  /** 工作区 .novel/design 目录绝对路径（runtime.files 读作用域）。 */
  /** Absolute path to the workspace design directory (runtime.files read scope). */
  readonly designRoot: string;
  readonly logger?: Logger;
}

export interface ChildNovelToolRegistry {
  readonly registry: ToolRegistry;
  readonly groups: ToolGroupCatalog;
}

/** 解析 workspace 并打开真实 novel 工具注册表。Resolves the workspace and opens the real registry. */
export async function openChildNovelToolRegistry(
  options: ChildNovelToolRegistryOptions,
): Promise<ChildNovelToolRegistry> {
  const logger = (options.logger ?? noopLogger).child({
    component: "child_novel_tool_registry",
  });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: options.storageRoot,
  }).resolve(options.workdir);
  const designRoot = path.join(workspace.workspaceRoot, ".novel", "design");
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  const canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    logger,
  });
  let novelId;
  try {
    novelId = (await canonicalStore.getMetadata()).novelId;
  } finally {
    await canonicalStore.close().catch(() => undefined);
  }
  logger.info("child_novel_tool_registry.opened", { novelId });
  return createChildNovelToolRegistry({
    location,
    novelId,
    designRoot,
    todoWriter: options.todoWriter,
    composeState: options.composeState,
    eventSink: options.eventSink,
    logger,
  });
}

export function createChildNovelToolRegistry(
  options: CreateChildNovelToolRegistryOptions,
): ChildNovelToolRegistry {
  const logger = (options.logger ?? noopLogger).child({
    component: "child_novel_tool_registry",
    novelId: options.novelId,
  });
  const clock = new SystemNovelClock();
  const identityFactory = new ChildNovelIdentityFactory();
  const executor = new NovelOperationExecutor(
    createDefaultNovelOperationRegistry<NovelMutationContext>(),
  );
  const canonicalWrites = new SqliteNovelCanonicalWriter({
    location: options.location,
    novelId: options.novelId,
    executor,
    contextFactory: createSqliteNovelMutationContext,
    clock,
    logger,
  });
  const entityQueryStore = new SqliteNovelEntityQueryStore({
    location: options.location,
    novelId: options.novelId,
    logger,
  });
  const outlineQueryStore = new SqliteNovelOutlineQueryStore({
    location: options.location,
    novelId: options.novelId,
    logger,
  });
  const paragraphQueryStore = new SqliteNovelParagraphQueryStore({
    location: options.location,
    novelId: options.novelId,
    logger,
  });
  const publicationQueryStore = new SqliteNovelPublicationQueryStore({
    location: options.location,
    novelId: options.novelId,
    logger,
  });
  const characterQueries = new CharacterQueryService(entityQueryStore);
  const composeCommitStore = new SqliteNovelComposeCommitStore({
    location: options.location,
    novelId: options.novelId,
    logger,
  });
  const locationQueries = new LocationQueryService(entityQueryStore);
  const outlineQueries = new StoryOutlineQueryService(outlineQueryStore);
  const paragraphQueries = new ParagraphQueryService(paragraphQueryStore);
  const publicationQueries = new PublicationQueryService(publicationQueryStore);

  const registry = new ToolRegistry([
    ...createTodoToolRegistry({ writer: options.todoWriter }).list(),
    ...createNovelComposeToolRegistry({
      service: new ComposeToolService({
        composeState: options.composeState,
        designRoot: options.designRoot,
        eventSink: options.eventSink,
        commitRecorder: composeCommitStore,
        logger,
      }),
      logger,
    }).list(),
    ...createFileToolRegistry({
      service: new FileToolService({ designRoot: options.designRoot }),
      logger,
    }).list(),
    ...createNovelOutlineToolRegistry({
      service: new OutlineToolService({
        novelId: options.novelId,
        outlineQueries,
        canonicalWrites,
        identityFactory,
        logger,
      }),
      logger,
    }).list(),
    ...createNovelCharacterToolRegistry({
      service: new NovelCharacterToolService({
        characterQueries,
        canonicalWrites,
        identityFactory,
        clock,
        logger,
      }),
      logger,
    }).list(),
    ...createNovelLocationToolRegistry({
      service: new NovelLocationToolService({
        locationQueries,
        canonicalWrites,
        identityFactory,
        clock,
        logger,
      }),
      logger,
    }).list(),
    ...createNovelParagraphToolRegistry({
      service: new NovelParagraphToolService({
        paragraphQueries,
        canonicalWrites,
        identityFactory,
        logger,
      }),
      logger,
    }).list(),
    ...createNovelPublicationToolRegistry({
      service: new NovelPublicationToolService({
        novelId: options.novelId,
        publicationQueries,
        paragraphs: paragraphQueries,
        canonicalWrites,
        identityFactory,
        logger,
      }),
      logger,
    }).list(),
    ...createNovelDeleteToolRegistry({
      service: new NovelDeleteToolService({
        outlineQueries,
        characterQueries,
        locationQueries,
        paragraphQueries,
        publicationQueries,
        canonicalWrites,
        identityFactory,
        logger,
      }),
      logger,
    }).list(),
  ]);
  const groups = new ToolGroupCatalog([
    loadToolGroupManifest(RUNTIME_TODO_TOOL_GROUP_MANIFEST),
    NOVEL_COMPOSE_TOOL_GROUP_MANIFEST,
    RUNTIME_FILES_TOOL_GROUP_MANIFEST,
    NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
    NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
    NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
    NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST,
    NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST,
    NOVEL_DELETE_TOOL_GROUP_MANIFEST,
  ]);
  return Object.freeze({ registry, groups });
}

/** Child 组合身份工厂：真实随机 id 供工具创建实体。Combined child identity factory. */
class ChildNovelIdentityFactory {
  private readonly storyIdentityFactory = new RandomStoryIdentityFactory();

  createStoryOutlineId() {
    return this.storyIdentityFactory.createStoryOutlineId();
  }

  createStoryUnitId() {
    return this.storyIdentityFactory.createStoryUnitId();
  }

  createCharacterId(): CharacterId {
    return captureCharacterId(randomIdentity("character"));
  }

  createLocationId(): LocationId {
    return captureLocationId(randomIdentity("location"));
  }

  createParagraphId(): ParagraphId {
    return captureParagraphId(randomIdentity("paragraph"));
  }

  createPublicationStructureId(): PublicationStructureId {
    return capturePublicationStructureId(randomIdentity("publication"));
  }

  createPublicationVolumeId(): PublicationVolumeId {
    return capturePublicationVolumeId(randomIdentity("publication_volume"));
  }

  createPublicationChapterId(): PublicationChapterId {
    return capturePublicationChapterId(randomIdentity("publication_chapter"));
  }

  createOperationId(): NovelOperationId {
    return captureNovelOperationId(randomIdentity("operation"));
  }
}

function randomIdentity(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
