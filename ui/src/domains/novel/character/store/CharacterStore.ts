/**
 * CharacterStore
 *
 * 角色域 store：列表 + 详情缓存 + 本地选中 + 写路径（create/update/delete，乐观锁）。
 * 映射说明：core Character 无 role/relatedUnits 字段，role 取首个 alias，
 * profile 取 authorNotes，relatedUnits 留空（等 binding 查询落地）。
 * stale：NovelStaleRevisionError 经门面归一为 RPCError code:"stale"——自动重拉
 * 并置 error 提示（数据已被更新）。
 */
import type { Character, CharacterId, CharacterInput, Logger, NovelApiClient } from "@novel/core";
import { noopLogger } from "@novel/core/client";
import { ExternalStore } from "../../../../shared/state/ExternalStore.js";
import { TaskSerializer } from "../../../../shared/state/TaskSerializer.js";
import type { NovelDomainError } from "../../outline/store/StoryOutlineTreeStore.js";

export interface CharacterSummary {
  readonly characterId: string;
  readonly avatarText: string;
  readonly name: string;
  readonly role: string;
  readonly note: string;
  readonly relatedUnits: readonly string[];
}

export interface CharacterDetail {
  readonly characterId: string;
  readonly avatarText: string;
  readonly name: string;
  readonly role: string;
  readonly profile: string;
  readonly version: number;
  readonly relatedUnits: readonly { readonly unitId: string; readonly label: string }[];
}

export interface CharacterSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly characters: readonly CharacterSummary[];
  readonly detailCache: ReadonlyMap<string, CharacterDetail>;
  readonly selectedId: string | undefined;
  readonly error: NovelDomainError | undefined;
}

const EMPTY_SNAPSHOT: CharacterSnapshot = Object.freeze({
  phase: "idle",
  workspaceId: undefined,
  characters: Object.freeze([]),
  detailCache: new Map<string, CharacterDetail>(),
  selectedId: undefined,
  error: undefined,
});

export class CharacterStore extends ExternalStore<CharacterSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  /** 变更串行（乐观锁操作不并发） */
  private readonly serializer = new TaskSerializer();
  private generation = 0;

  constructor(deps: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    super(EMPTY_SNAPSHOT);
    this.api = deps.api;
    this.logger = (deps.logger ?? noopLogger).child({
      component: "character_store",
    });
  }

  async loadWorkspace(workspaceId: string): Promise<void> {
    const capturedId = requireNonBlank(workspaceId, "Workspace id");
    const generation = ++this.generation;
    this.setSnapshot({
      ...EMPTY_SNAPSHOT,
      phase: "loading",
      workspaceId: capturedId,
    });
    try {
      const result = await this.api.novel.characters.list();
      if (generation !== this.generation) return;
      this.setSnapshot({
        phase: "ready",
        workspaceId: capturedId,
        characters: Object.freeze(result.map(captureSummary)),
        detailCache: new Map<string, CharacterDetail>(),
        selectedId: undefined,
        error: undefined,
      });
      this.logger.info("character_store.load_completed", { characterCount: result.length });
    } catch {
      if (generation !== this.generation) return;
      this.setSnapshot({
        ...EMPTY_SNAPSHOT,
        phase: "error",
        workspaceId: capturedId,
        error: {
          code: "novel-load-failed",
          message: "角色列表加载失败，请重试",
          retryable: true,
        },
      });
      this.logger.warn("character_store.load_failed");
    }
  }

  async loadDetail(characterId: string): Promise<void> {
    const capturedId = requireNonBlank(characterId, "Character id");
    if (this.snapshot.detailCache.has(capturedId)) return;
    const generation = this.generation;
    try {
      const character = await this.api.novel.characters.get(capturedId as CharacterId);
      if (generation !== this.generation) return;
      const detail = captureDetail(character);
      const detailCache = new Map(this.snapshot.detailCache);
      detailCache.set(capturedId, detail);
      this.setSnapshot({ ...this.snapshot, detailCache });
      this.logger.info("character_store.detail_loaded");
    } catch {
      this.logger.warn("character_store.detail_load_failed");
    }
  }

  selectCharacter(id: string | undefined): void {
    this.setSnapshot({ ...this.snapshot, selectedId: id });
  }

  invalidate(): Promise<void> {
    const workspaceId = this.snapshot.workspaceId;
    if (workspaceId === undefined) return Promise.resolve();
    return this.loadWorkspace(workspaceId);
  }

  /**
   * 新建角色（成功后刷新列表并选中新角色）
   * @param input 角色档案输入
   */
  createCharacter(input: CharacterInput): Promise<void> {
    const workspaceId = this.snapshot.workspaceId;
    if (workspaceId === undefined) return Promise.resolve();
    return this.serializer.run(async () => {
      const result = await this.api.novel.mutate({ op: "character.create", input });
      await this.loadWorkspace(workspaceId);
      this.setSnapshot({ ...this.snapshot, selectedId: result.changeId });
    });
  }

  /**
   * 更新角色（乐观锁；stale 时自动重拉并置提示）
   * @param characterId 角色 id
   * @param patch 变更字段
   * @param baseRevision 最近读到的版本（entityVersion）
   */
  updateCharacter(characterId: string, patch: Partial<CharacterInput>, baseRevision: number): Promise<void> {
    return this.serializer.run(async () => {
      await this.runGuarded(
        () =>
          this.api.novel.mutate({
            op: "character.update",
            characterId: characterId as CharacterId,
            baseRevision,
            patch,
          }),
        "角色",
      );
    });
  }

  /**
   * 删除角色（乐观锁；成功后清选中并刷新）
   * @param characterId 角色 id
   * @param baseRevision 最近读到的版本（entityVersion）
   */
  deleteCharacter(characterId: string, baseRevision: number): Promise<void> {
    return this.serializer.run(async () => {
      await this.runGuarded(
        () =>
          this.api.novel.mutate({
            op: "character.delete",
            characterId: characterId as CharacterId,
            baseRevision,
          }),
        "角色",
      );
      const workspaceId = this.snapshot.workspaceId;
      this.setSnapshot({ ...this.snapshot, selectedId: undefined });
      if (workspaceId !== undefined) await this.loadWorkspace(workspaceId);
    });
  }

  /** 变更执行 + stale/通用错误处理（stale → 自动重拉 + 置错误提示） */
  private async runGuarded(mutate: () => Promise<unknown>, label: string): Promise<void> {
    try {
      await mutate();
      this.setSnapshot({ ...this.snapshot, error: undefined });
      const workspaceId = this.snapshot.workspaceId;
      if (workspaceId !== undefined) await this.loadWorkspace(workspaceId);
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === "stale") {
        this.setSnapshot({
          ...this.snapshot,
          error: {
            code: "novel-stale",
            message: `${label}数据已被更新，已刷新为最新版本，请重试`,
            retryable: true,
          },
        });
        const workspaceId = this.snapshot.workspaceId;
        if (workspaceId !== undefined) await this.loadWorkspace(workspaceId);
        return;
      }
      this.setSnapshot({
        ...this.snapshot,
        error: {
          code: "novel-mutate-failed",
          message: `${label}保存失败，请重试`,
          retryable: true,
        },
      });
      this.logger.warn("character_store.mutate_failed");
    }
  }
}

function captureSummary(character: Character): CharacterSummary {
  return Object.freeze({
    characterId: character.id,
    avatarText: character.name.slice(0, 1),
    name: character.name,
    role: character.aliases[0] ?? "角色",
    note: character.summary ?? "",
    relatedUnits: Object.freeze([]),
  });
}

function captureDetail(character: Character): CharacterDetail {
  return Object.freeze({
    characterId: character.id,
    avatarText: character.name.slice(0, 1),
    name: character.name,
    role: character.aliases[0] ?? "角色",
    profile: character.authorNotes ?? "",
    version: character.entityVersion,
    relatedUnits: Object.freeze([]),
  });
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
