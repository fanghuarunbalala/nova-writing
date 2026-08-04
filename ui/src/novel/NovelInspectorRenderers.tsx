/** Default read-only Novel Inspector renderers backed by the shared query Client. */
import {
  ApiRemoteError,
  ApiTransportError,
  canonicalNovelQueryScope,
  captureCharacterId,
  captureLocationId,
  captureManuscriptBlockId,
  captureStoryUnitId,
  type Character,
  type Location,
  type NovelManuscriptStructureSnapshot,
  type NovelOutlineSnapshot,
  type NovelOverviewSnapshot,
  type NovelStoryUnitSnapshot,
} from "@novel/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNovelApi } from "../client/index.js";
import {
  emptyInspectorRendererRegistry,
  type InspectorRendererProps,
  type InspectorRendererRegistry,
  type InspectorTarget,
  useInspectorStore,
} from "../inspector/index.js";
import {
  StoryOutlineTree,
  StoryOutlineTreeController,
  type StoryOutlineTreeView,
} from "../outline/index.js";

type QueryState<T> =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly value: T }
  | { readonly phase: "error"; readonly code: string };

const DEFAULT_RENDERERS = Object.freeze([
  ["story-outline", StoryOutlineInspector],
  ["story-unit-detail", StoryUnitInspector],
  ["character-index", CharacterIndexInspector],
  ["character-detail", CharacterDetailInspector],
  ["location-index", LocationIndexInspector],
  ["location-detail", LocationDetailInspector],
  ["manuscript-index", ManuscriptIndexInspector],
  ["manuscript-block", ManuscriptBlockInspector],
] as const);

export function createNovelInspectorRendererRegistry(
  base: InspectorRendererRegistry = emptyInspectorRendererRegistry,
): InspectorRendererRegistry {
  let registry = base;
  for (const [kind, renderer] of DEFAULT_RENDERERS) {
    if (!registry.has(kind)) registry = registry.withRenderer(kind, renderer);
  }
  return registry;
}

function StoryOutlineInspector({ target }: InspectorRendererProps) {
  const { api } = useNovelApi();
  const load = useCallback(
    () => Promise.all([
      api.novel.overview.get(canonicalNovelQueryScope),
      api.novel.outline.get(canonicalNovelQueryScope),
    ]),
    [api],
  );
  const state = useInspectorQuery(target, load);
  return (
    <QueryPresentation state={state} emptyLabel="大纲中还没有故事单元。">
      {(value) => <LoadedOutline overview={value[0]} outline={value[1]} />}
    </QueryPresentation>
  );
}

function LoadedOutline({
  overview,
  outline,
}: {
  readonly overview: NovelOverviewSnapshot;
  readonly outline: NovelOutlineSnapshot;
}) {
  const inspectorStore = useInspectorStore();
  const view = useMemo(
    () => createOutlineView(overview, outline),
    [outline, overview],
  );
  const controller = useMemo(
    () =>
      new StoryOutlineTreeController({
        view,
        expandedIds: view.rootIds,
      }),
    [view],
  );
  if (outline.tree === undefined) {
    return <p className="novel-query-empty">大纲中还没有故事单元。</p>;
  }
  return (
    <StoryOutlineTree
      controller={controller}
      onSelect={(storyUnitId) => {
        const node = view.nodes[storyUnitId];
        if (node === undefined) return;
        inspectorStore.open({
          key: `story-unit-detail:${storyUnitId}`,
          kind: "story-unit-detail",
          title: node.title,
          parameters: Object.freeze({ storyUnitId }),
        });
      }}
    />
  );
}

function StoryUnitInspector({ target }: InspectorRendererProps) {
  const { api } = useNovelApi();
  const storyUnitId = requireParameter(target, "storyUnitId");
  const load = useCallback(
    () => api.novel.outline.getStoryUnit(
      canonicalNovelQueryScope,
      captureStoryUnitId(storyUnitId),
    ),
    [api, storyUnitId],
  );
  const state = useInspectorQuery(target, load);
  return (
    <QueryPresentation state={state} emptyLabel="故事单元不存在。">
      {(snapshot) => snapshot.unit === undefined ? null : (
        <NovelDetailList>
          <Detail label="标题" value={snapshot.unit.title} />
          <Detail label="范围" value={snapshot.unit.scope ?? "未设置"} />
          <Detail label="规划状态" value={snapshot.unit.planningStatus} />
          <Detail label="写作状态" value={snapshot.unit.realizationStatus} />
          <Detail label="意图" value={snapshot.unit.intent ?? "未设置"} />
          <Detail label="梗概" value={snapshot.unit.synopsis ?? "未设置"} />
          <Detail
            label="叶节点进度"
            value={snapshot.progress === undefined
              ? "未计算"
              : `${snapshot.progress.completedLeafCount}/${snapshot.progress.totalLeafCount}`}
          />
        </NovelDetailList>
      )}
    </QueryPresentation>
  );
}

function CharacterIndexInspector({ target }: InspectorRendererProps) {
  const { api } = useNovelApi();
  const inspectorStore = useInspectorStore();
  const load = useCallback(
    () => api.novel.characters.list(canonicalNovelQueryScope),
    [api],
  );
  const state = useInspectorQuery(target, load);
  return (
    <QueryPresentation state={state} emptyLabel="还没有人物。">
      {(snapshot) => snapshot.characters.length === 0 ? null : (
        <NovelIndexList>
          {snapshot.characters.map((character) => (
            <NovelIndexButton
              key={character.id}
              title={character.name}
              subtitle={
                character.summary ?? (character.aliases.join(" · ") || "暂无简介")
              }
              onClick={() => inspectorStore.open(characterTarget(character))}
            />
          ))}
        </NovelIndexList>
      )}
    </QueryPresentation>
  );
}

function CharacterDetailInspector({ target }: InspectorRendererProps) {
  const { api } = useNovelApi();
  const characterId = requireParameter(target, "characterId");
  const load = useCallback(
    () => api.novel.characters.get(
      canonicalNovelQueryScope,
      captureCharacterId(characterId),
    ),
    [api, characterId],
  );
  const state = useInspectorQuery(target, load);
  return (
    <QueryPresentation state={state} emptyLabel="人物不存在。">
      {(snapshot) => snapshot.character === undefined
        ? null
        : <EntityDetail entity={snapshot.character} />}
    </QueryPresentation>
  );
}

function LocationIndexInspector({ target }: InspectorRendererProps) {
  const { api } = useNovelApi();
  const inspectorStore = useInspectorStore();
  const load = useCallback(
    () => api.novel.locations.list(canonicalNovelQueryScope),
    [api],
  );
  const state = useInspectorQuery(target, load);
  return (
    <QueryPresentation state={state} emptyLabel="还没有地点。">
      {(snapshot) => snapshot.locations.length === 0 ? null : (
        <NovelIndexList>
          {snapshot.locations.map((location) => (
            <NovelIndexButton
              key={location.id}
              title={location.name}
              subtitle={location.summary ?? location.initialState ?? "暂无简介"}
              onClick={() => inspectorStore.open(locationTarget(location))}
            />
          ))}
        </NovelIndexList>
      )}
    </QueryPresentation>
  );
}

function LocationDetailInspector({ target }: InspectorRendererProps) {
  const { api } = useNovelApi();
  const locationId = requireParameter(target, "locationId");
  const load = useCallback(
    () => api.novel.locations.get(
      canonicalNovelQueryScope,
      captureLocationId(locationId),
    ),
    [api, locationId],
  );
  const state = useInspectorQuery(target, load);
  return (
    <QueryPresentation state={state} emptyLabel="地点不存在。">
      {(snapshot) => snapshot.location === undefined
        ? null
        : <EntityDetail entity={snapshot.location} />}
    </QueryPresentation>
  );
}

function ManuscriptIndexInspector({ target }: InspectorRendererProps) {
  const { api } = useNovelApi();
  const inspectorStore = useInspectorStore();
  const load = useCallback(
    () => api.novel.manuscript.getStructure(canonicalNovelQueryScope),
    [api],
  );
  const state = useInspectorQuery(target, load);
  return (
    <QueryPresentation state={state} emptyLabel="正文结构尚未建立。">
      {(snapshot) => snapshot.publication === undefined || snapshot.manuscript === undefined
        ? null
        : (
            <ManuscriptStructure
              snapshot={snapshot}
              onBlockSelect={(blockId, title) => {
                inspectorStore.open({
                  key: `manuscript-block:${blockId}`,
                  kind: "manuscript-block",
                  title,
                  parameters: Object.freeze({ blockId }),
                });
              }}
            />
          )}
    </QueryPresentation>
  );
}

function ManuscriptBlockInspector({ target }: InspectorRendererProps) {
  const { api } = useNovelApi();
  const blockId = requireParameter(target, "blockId");
  const load = useCallback(
    () => api.novel.manuscript.getBlock(
      canonicalNovelQueryScope,
      captureManuscriptBlockId(blockId),
    ),
    [api, blockId],
  );
  const state = useInspectorQuery(target, load);
  return (
    <QueryPresentation state={state} emptyLabel="正文段落不存在。">
      {(snapshot) => snapshot.readModel === undefined ? null : (
        <article className="novel-manuscript-block-view">
          <header>
            <span>段落</span>
            <strong>{snapshot.readModel.block.id}</strong>
          </header>
          <p>{snapshot.readModel.block.text}</p>
        </article>
      )}
    </QueryPresentation>
  );
}

function ManuscriptStructure({
  snapshot,
  onBlockSelect,
}: {
  readonly snapshot: NovelManuscriptStructureSnapshot;
  readonly onBlockSelect: (blockId: string, title: string) => void;
}) {
  const publication = snapshot.publication;
  if (publication === undefined) return null;
  return (
    <div className="novel-manuscript-structure">
      {publication.volumes.map((volume) => (
        <section key={volume.id}>
          <header>
            <span>卷</span>
            <h3>{volume.title}</h3>
          </header>
          {publication.chapters
            .filter((chapter) => chapter.volumeId === volume.id)
            .map((chapter) => {
              const blocks = snapshot.blocks.filter(
                (block) => block.chapterId === chapter.id,
              );
              return (
                <div className="novel-manuscript-chapter" key={chapter.id}>
                  <h4>{chapter.title}</h4>
                  {blocks.length === 0 ? (
                    <p className="novel-query-empty">本章还没有正文。</p>
                  ) : blocks.map((block, index) => (
                    <NovelIndexButton
                      key={block.id}
                      title={`段落 ${index + 1}`}
                      subtitle={`${block.textLength} 字符`}
                      onClick={() => onBlockSelect(block.id, `${chapter.title} · 段落 ${index + 1}`)}
                    />
                  ))}
                </div>
              );
            })}
        </section>
      ))}
    </div>
  );
}

function EntityDetail({ entity }: { readonly entity: Character | Location }) {
  return (
    <NovelDetailList>
      <Detail label="名称" value={entity.name} />
      <Detail label="别名" value={entity.aliases.join("、") || "无"} />
      <Detail label="简介" value={entity.summary ?? "未设置"} />
      <Detail label="初始状态" value={entity.initialState ?? "未设置"} />
      <Detail label="作者备注" value={entity.authorNotes ?? "未设置"} />
      <Detail label="版本" value={String(entity.entityVersion)} />
    </NovelDetailList>
  );
}

function NovelDetailList({ children }: { readonly children: ReactNode }) {
  return <dl className="novel-query-detail-list">{children}</dl>;
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function NovelIndexList({ children }: { readonly children: ReactNode }) {
  return <div className="novel-query-index-list">{children}</div>;
}

function NovelIndexButton({
  title,
  subtitle,
  onClick,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly onClick: () => void;
}) {
  return (
    <button className="novel-query-index-button" type="button" onClick={onClick}>
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </button>
  );
}

function QueryPresentation<T>({
  state,
  emptyLabel,
  children,
}: {
  readonly state: QueryState<T>;
  readonly emptyLabel: string;
  readonly children: (value: T) => ReactNode | null;
}) {
  if (state.phase === "loading") {
    return <p className="novel-query-empty">正在读取内容…</p>;
  }
  if (state.phase === "error") {
    return <p className="novel-query-error">内容读取失败（{state.code}）</p>;
  }
  return children(state.value) ?? <p className="novel-query-empty">{emptyLabel}</p>;
}

function useInspectorQuery<T>(
  target: InspectorTarget,
  load: () => Promise<T>,
): QueryState<T> {
  const inspectorStore = useInspectorStore();
  const [state, setState] = useState<QueryState<T>>(Object.freeze({ phase: "loading" }));
  useEffect(() => {
    let cancelled = false;
    setState(Object.freeze({ phase: "loading" }));
    inspectorStore.markLoading(target.key);
    void load().then(
      (value) => {
        if (cancelled) return;
        setState(Object.freeze({ phase: "ready", value }));
        inspectorStore.markLoaded(target.key);
      },
      (error: unknown) => {
        if (cancelled) return;
        const failure = captureFailure(error);
        setState(Object.freeze({ phase: "error", code: failure.code }));
        inspectorStore.markError(target.key, failure.code, failure.retryable);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [inspectorStore, load, target.key]);
  return state;
}

function createOutlineView(
  overview: NovelOverviewSnapshot,
  outline: NovelOutlineSnapshot,
): StoryOutlineTreeView {
  const units = outline.tree?.units ?? [];
  const progressById = new Map(
    outline.progress.map((progress) => [progress.storyUnitId, progress]),
  );
  const childrenByParent = new Map<string | undefined, string[]>();
  for (const unit of units) {
    const children = childrenByParent.get(unit.parentId) ?? [];
    children.push(unit.id);
    childrenByParent.set(unit.parentId, children);
  }
  return Object.freeze({
    outlineId: outline.tree?.outline.id ?? `outline:${overview.novelId}`,
    readScope: Object.freeze({ kind: "canonical" }),
    sourceRevision: overview.sourceRevision,
    rootIds: Object.freeze(childrenByParent.get(undefined) ?? []),
    nodes: Object.freeze(Object.fromEntries(units.map((unit) => {
      const progress = progressById.get(unit.id);
      return [unit.id, Object.freeze({
        id: unit.id,
        ...(unit.parentId === undefined ? {} : { parentId: unit.parentId }),
        orderKey: unit.orderKey,
        childIds: Object.freeze(childrenByParent.get(unit.id) ?? []),
        title: unit.title,
        ...(unit.intent === undefined ? {} : { intent: unit.intent }),
        ...(unit.synopsis === undefined ? {} : { synopsis: unit.synopsis }),
        ...(unit.scope === undefined
          ? {}
          : { scope: Object.freeze({ code: unit.scope, label: scopeLabel(unit.scope) }) }),
        planningStatus: unit.planningStatus,
        realizationStatus: unit.realizationStatus,
        ...(unit.blockState === undefined
          ? {}
          : {
              blockState: Object.freeze({
                code: unit.blockState.reasonCode ?? "blocked",
                label: unit.blockState.note ?? unit.blockState.reasonCode ?? "已阻塞",
              }),
            }),
        ...(unit.abandonment === undefined
          ? {}
          : {
              abandonment: Object.freeze({
                code: unit.abandonment.reasonCode ?? "abandoned",
                label: unit.abandonment.note ?? unit.abandonment.reasonCode ?? "已放弃",
              }),
            }),
        progress: Object.freeze({
          completedLeafCount: progress?.completedLeafCount ?? 0,
          totalLeafCount: progress?.totalLeafCount ?? 0,
        }),
      })];
    }))),
  });
}

function characterTarget(character: Character): InspectorTarget {
  return Object.freeze({
    key: `character-detail:${character.id}`,
    kind: "character-detail",
    title: character.name,
    parameters: Object.freeze({ characterId: character.id }),
  });
}

function locationTarget(location: Location): InspectorTarget {
  return Object.freeze({
    key: `location-detail:${location.id}`,
    kind: "location-detail",
    title: location.name,
    parameters: Object.freeze({ locationId: location.id }),
  });
}

function requireParameter(target: InspectorTarget, name: string): string {
  const value = target.parameters?.[name];
  if (value === undefined || value.length === 0) {
    throw new TypeError("Novel Inspector target parameter is missing");
  }
  return value;
}

function scopeLabel(scope: string): string {
  const labels: Readonly<Record<string, string>> = Object.freeze({
    saga: "长篇",
    arc: "篇章",
    sequence: "段落组",
    scene: "场景",
    custom: "自定义",
  });
  return labels[scope] ?? scope;
}

function captureFailure(error: unknown): {
  readonly code: string;
  readonly retryable: boolean;
} {
  if (error instanceof ApiRemoteError || error instanceof ApiTransportError) {
    return Object.freeze({ code: error.code, retryable: error.retryable });
  }
  return Object.freeze({ code: "NOVEL_QUERY_FAILED", retryable: false });
}
