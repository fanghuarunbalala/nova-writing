/**
 * NovelApiClient：精简客户端门面（重建版）。
 * 把 ConversationManagerHandle（目录/生命周期）+ NovelHandle（查询/变更）包装成 UI 消费的
 * conversations / novel 两个子 API。错误已在 handle 层归一为 RPCError。
 */

import type { ConversationManagerHandle } from "../manager/ConversationManagerHandle.js";
import type { NovelHandle } from "../novel/client/NovelHandle.js";
import type { ConversationManagerServer } from "../conversation/server/ConversationManagerServer.js";
import type { NovelStore } from "../novel/store.js";
import type { ConversationRef, ConversationSummary } from "../manager/contract/types.js";
import type { ConversationHandle, ConversationId } from "../conversation/contract/index.js";
import type { AgentType } from "../conversation/contract/types/index.js";
import type { NovelMutation } from "../novel/contract/mutation.js";
import type {
	NovelMutateResult,
	NovelOverview,
	PublicationSnapshot,
	StoryOutlineSnapshot,
} from "../novel/contract/snapshot.js";
import type {
	Character,
	CharacterId,
	Location,
	LocationId,
	Paragraph,
	ParagraphId,
	StoryUnit,
	StoryUnitId,
} from "../novel/model/index.js";

/** 会话子 API（目录 + 生命周期；rename/pin 延后） */
export interface ConversationApi {
	/**
	 * 列出所有会话摘要
	 * @returns 会话摘要列表
	 */
	list(): Promise<ConversationSummary[]>;
	/**
	 * 新建会话（默认 novel agent）
	 * @param agentType agent 类型（缺省 novel）
	 * @returns 会话引用（含对端 handle）
	 */
	create(agentType?: AgentType): Promise<ConversationRef>;
	/**
	 * 打开（或恢复）会话
	 * @param conversationId 会话 id
	 * @returns 会话对端 handle
	 */
	open(conversationId: ConversationId): Promise<ConversationHandle>;
	/**
	 * 删除会话
	 * @param conversationId 会话 id
	 */
	delete(conversationId: ConversationId): Promise<void>;
}

/** novel 查询子 API（按 op 包装 NovelHandle.query 的强类型面） */
export interface NovelContentApi {
	overview: {
		/** 小说总览 */
		get(): Promise<NovelOverview>;
	};
	outline: {
		/** 大纲（含 story unit 树） */
		get(): Promise<StoryOutlineSnapshot>;
		/** 单个 story unit */
		getStoryUnit(id: StoryUnitId): Promise<StoryUnit>;
	};
	characters: {
		/** 角色列表 */
		list(): Promise<Character[]>;
		/** 单个角色 */
		get(id: CharacterId): Promise<Character>;
	};
	locations: {
		/** 地点列表 */
		list(): Promise<Location[]>;
		/** 单个地点 */
		get(id: LocationId): Promise<Location>;
	};
	paragraphs: {
		/** 某 story unit 的段落列表（按 orderKey） */
		list(storyUnitId: StoryUnitId): Promise<Paragraph[]>;
		/** 单个段落 */
		get(id: ParagraphId): Promise<Paragraph>;
	};
	publication: {
		/** 发布结构（卷/章） */
		get(): Promise<PublicationSnapshot>;
	};
	/**
	 * 变更（乐观锁；stale 抛 NovelStaleRevisionError → RPCError）
	 * @param m 变更
	 * @returns 变更结果
	 */
	mutate(m: NovelMutation): Promise<NovelMutateResult>;
}

/** 客户端门面：conversations + novel 两域 */
export interface NovelApiClient {
	readonly conversations: ConversationApi;
	readonly novel: NovelContentApi;
}

/** 门面构造依赖（注入两域 handle） */
export interface NovelApiClientOptions {
	/** manager 客户端（目录 / 生命周期） */
	manager: ConversationManagerHandle;
	/** novel 客户端（查询 / 变更） */
	novel: NovelHandle;
}

/**
 * 创建客户端门面
 * @param options manager + novel handle
 * @returns NovelApiClient
 */
export function createNovelApiClient(options: NovelApiClientOptions): NovelApiClient {
	const { manager, novel } = options;
	return {
		conversations: {
			list: () => manager.list(),
			create: (agentType = "novel") => manager.spawnConversation({ agentType }),
			open: async (conversationId) => (await manager.createOrResume(conversationId)).handle,
			delete: (conversationId) => manager.delete(conversationId),
		},
		novel: {
			overview: {
				get: () => novel.query<NovelOverview>({ op: "overview.get" }),
			},
			outline: {
				get: () => novel.query<StoryOutlineSnapshot>({ op: "outline.get" }),
				getStoryUnit: (id) =>
					novel.query<StoryUnit>({ op: "outline.storyUnit.get", storyUnitId: id }),
			},
			characters: {
				list: () => novel.query<Character[]>({ op: "characters.list" }),
				get: (id) => novel.query<Character>({ op: "characters.get", characterId: id }),
			},
			locations: {
				list: () => novel.query<Location[]>({ op: "locations.list" }),
				get: (id) => novel.query<Location>({ op: "locations.get", locationId: id }),
			},
			paragraphs: {
				list: (storyUnitId) =>
					novel.query<Paragraph[]>({ op: "paragraphs.list", storyUnitId }),
				get: (id) => novel.query<Paragraph>({ op: "paragraph.get", paragraphId: id }),
			},
			publication: {
				get: () => novel.query<PublicationSnapshot>({ op: "publication.get" }),
			},
			mutate: (m) => novel.mutate(m),
		},
	};
}

/** 服务端门面构造依赖（expose 侧：manager 服务端 + novel 存储） */
export interface NovelApiServerOptions {
	/** manager 服务端（目录 / 生命周期） */
	manager: ConversationManagerServer;
	/** novel 存储（query / mutate） */
	novel: NovelStore;
}

/**
 * 创建服务端门面（expose 侧，与 createNovelApiClient 对称）。
 * 供宿主进程（Electron main / novel-db 守护）直接 expose 给 UI。
 * @param options manager 服务端 + novel 存储
 * @returns NovelApiClient 形状的服务端实现
 */
export function createNovelApiServer(options: NovelApiServerOptions): NovelApiClient {
	const { manager, novel } = options;
	return {
		conversations: {
			list: () => manager.list(),
			create: (agentType = "novel") => manager.spawnConversation({ agentType }),
			open: async (conversationId) => (await manager.createOrResume(conversationId)).handle,
			delete: (conversationId) => manager.delete(conversationId),
		},
		novel: {
			overview: {
				get: () => novel.query({ op: "overview.get" }) as Promise<NovelOverview>,
			},
			outline: {
				get: () => novel.query({ op: "outline.get" }) as Promise<StoryOutlineSnapshot>,
				getStoryUnit: (id) =>
					novel.query({ op: "outline.storyUnit.get", storyUnitId: id }) as Promise<StoryUnit>,
			},
			characters: {
				list: () => novel.query({ op: "characters.list" }) as Promise<Character[]>,
				get: (id) =>
					novel.query({ op: "characters.get", characterId: id }) as Promise<Character>,
			},
			locations: {
				list: () => novel.query({ op: "locations.list" }) as Promise<Location[]>,
				get: (id) =>
					novel.query({ op: "locations.get", locationId: id }) as Promise<Location>,
			},
			paragraphs: {
				list: (storyUnitId) =>
					novel.query({ op: "paragraphs.list", storyUnitId }) as Promise<Paragraph[]>,
				get: (id) =>
					novel.query({ op: "paragraph.get", paragraphId: id }) as Promise<Paragraph>,
			},
			publication: {
				get: () => novel.query({ op: "publication.get" }) as Promise<PublicationSnapshot>,
			},
			mutate: (m) => novel.mutate(m),
		},
	};
}
