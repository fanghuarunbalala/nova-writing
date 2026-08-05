/**
 * CharacterStore
 *
 * 角色域 store：列表 + 详情缓存 + 本地选中。
 * 映射说明：core Character 无 role/relatedUnits 字段，role 取首个 alias，
 * profile 取 authorNotes，relatedUnits 留空（等 binding 查询落地）。
 */
import {
  canonicalNovelQueryScope,
  noopLogger,
  type Character,
  type CharacterId,
  type Logger,
  type NovelApiClient,
} from "@novel/core";
import { ExternalStore } from "../../../../shared/state/ExternalStore.js";
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
      const result = await this.api.novel.characters.list(canonicalNovelQueryScope);
      if (generation !== this.generation) return;
      this.setSnapshot({
        phase: "ready",
        workspaceId: capturedId,
        characters: Object.freeze(result.characters.map(captureSummary)),
        detailCache: new Map<string, CharacterDetail>(),
        selectedId: undefined,
        error: undefined,
      });
      this.logger.info("character_store.load_completed", { characterCount: result.characters.length });
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
      const result = await this.api.novel.characters.get(
        canonicalNovelQueryScope,
        capturedId as CharacterId,
      );
      if (generation !== this.generation || result.character === undefined) return;
      const detail = captureDetail(result.character);
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
