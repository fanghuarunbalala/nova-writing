import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FractionalOrderKeyFactory,
  NovelDraftSessionService,
  NovelOperationPreconditionError,
  canonicalNovelReadScope,
  captureNovelCommitId,
  captureNovelRevision,
  captureNovelTimestamp,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  draftNovelReadScope,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftStore,
  SqliteNovelSnapshotter,
  createNodeNovelApplication,
} from "../dist/node/index.js";

class DraftIdentityFactory {
  createDraftSessionId() {
    return "draft_publication_application";
  }
}

class FixedRevisionFactory {
  constructor(value) {
    this.value = captureNovelRevision(value);
  }
  createRevision() {
    return this.value;
  }
}

class SequenceClock {
  offset = 0;
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 3, 11, 0, 0, this.offset++)).toISOString(),
    );
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

function assertRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) assert.equal(serialized.includes(value), false);
  for (const entry of entries) {
    for (const key of Object.keys(entry.fields)) {
      assert.equal([
        "payload",
        "content",
        "text",
        "title",
        "prompt",
        "path",
        "message",
        "error",
        "stack",
        "cause",
      ].includes(key), false);
    }
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-publication-application-"));
const workspaceRoot = join(root, "workspace");
const logs = [];
const logger = new CollectingLogger(logs);
let canonicalStore;
let draftStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory("revision_publication_base"),
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const clock = new SequenceClock();
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({
      location,
      novelId: canonical.novelId,
      logger,
    }),
    identityFactory: new DraftIdentityFactory(),
    clock,
    logger,
  });
  const session = await drafts.startDraft("conversation-publication-application");
  const application = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
    logger,
  });
  assert.equal(
    await application.publicationQueries.getCatalog(canonicalNovelReadScope),
    undefined,
  );

  const publicationId = capturePublicationStructureId("publication_application");
  const volumeId = capturePublicationVolumeId("volume_application_main");
  const temporaryVolumeId = capturePublicationVolumeId("volume_application_temporary");
  const chapterId = capturePublicationChapterId("chapter_application_main");
  const temporaryChapterId = capturePublicationChapterId("chapter_application_temporary");
  const orderKeys = new FractionalOrderKeyFactory();
  const first = orderKeys.initial();
  const second = orderKeys.after(first);
  const forbiddenVolumeTitle = "FORBIDDEN_PUBLICATION_VOLUME_TITLE";
  const forbiddenChapterTitle = "FORBIDDEN_PUBLICATION_CHAPTER_TITLE";
  const draftScope = draftNovelReadScope(session);

  await application.publication.createPublication(session, publicationId);
  await application.publication.createVolume(session, capturePublicationVolume({
    id: volumeId,
    publicationId,
    orderKey: first,
    title: "Initial volume title",
  }));
  const initialVolume = await application.publicationQueries.getVolume(draftScope, volumeId);
  await assert.rejects(
    application.publication.replaceVolume(
      session,
      capturePublicationVolume({
        ...initialVolume.volume,
        title: "Rejected stale replacement",
      }),
      "0".repeat(64),
    ),
    (error) =>
      error instanceof NovelOperationPreconditionError &&
      error.failure === "field_digest_mismatch" &&
      error.entityId === volumeId,
  );
  await application.publication.replaceVolume(
    session,
    capturePublicationVolume({
      ...initialVolume.volume,
      title: forbiddenVolumeTitle,
    }),
    initialVolume.recordDigest,
  );
  await application.publication.createVolume(session, capturePublicationVolume({
    id: temporaryVolumeId,
    publicationId,
    orderKey: second,
    title: "Temporary volume",
  }));
  await application.publication.createChapter(session, capturePublicationChapter({
    id: chapterId,
    publicationId,
    volumeId,
    orderKey: first,
    title: "Initial chapter title",
  }));
  const initialChapter = await application.publicationQueries.getChapter(draftScope, chapterId);
  await application.publication.replaceChapter(
    session,
    capturePublicationChapter({
      ...initialChapter.chapter,
      title: forbiddenChapterTitle,
    }),
    initialChapter.recordDigest,
  );
  await application.publication.createChapter(session, capturePublicationChapter({
    id: temporaryChapterId,
    publicationId,
    volumeId: temporaryVolumeId,
    orderKey: first,
    title: "Temporary chapter",
  }));
  const temporaryChapter = await application.publicationQueries.getChapter(
    draftScope,
    temporaryChapterId,
  );
  await application.publication.deleteChapter(
    session,
    temporaryChapterId,
    temporaryChapter.recordDigest,
  );
  const temporaryVolume = await application.publicationQueries.getVolume(
    draftScope,
    temporaryVolumeId,
  );
  await application.publication.deleteVolume(
    session,
    temporaryVolumeId,
    temporaryVolume.recordDigest,
  );

  const draftCatalog = await application.publicationQueries.getCatalog(draftScope);
  assert.equal(Object.isFrozen(draftCatalog), true);
  assert.deepEqual(draftCatalog.snapshot.volumes.map((volume) => volume.id), [volumeId]);
  assert.deepEqual(draftCatalog.snapshot.chapters.map((chapter) => chapter.id), [chapterId]);
  assert.equal(draftCatalog.snapshot.volumes[0].title, forbiddenVolumeTitle);
  assert.equal(draftCatalog.snapshot.chapters[0].title, forbiddenChapterTitle);
  assert.equal(draftCatalog.volumeDigests[volumeId].length, 64);
  assert.equal(draftCatalog.chapterDigests[chapterId].length, 64);
  assert.equal(
    await application.publicationQueries.getCatalog(canonicalNovelReadScope),
    undefined,
  );

  const changeSet = await application.changeSets.build(session);
  assert.equal(changeSet.operationCount, 9);
  const resultRevision = captureNovelRevision("revision_publication_committed");
  const committed = await application.commits.commit(session, {
    commitId: captureNovelCommitId("commit_publication_application"),
    resultRevision,
    committedAt: captureNovelTimestamp("2026-08-03T11:30:00.000Z"),
  });
  assert.equal(committed.status, "committed");
  assert.equal((await canonicalStore.getMetadata()).currentRevision, resultRevision);

  const canonicalCatalog = await application.publicationQueries.getCatalog(
    canonicalNovelReadScope,
  );
  assert.deepEqual(canonicalCatalog.snapshot, draftCatalog.snapshot);
  assert.deepEqual(canonicalCatalog.volumeDigests, draftCatalog.volumeDigests);
  assert.deepEqual(canonicalCatalog.chapterDigests, draftCatalog.chapterDigests);

  const restarted = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
    logger,
  });
  assert.equal(
    (await restarted.publicationQueries.getVolume(
      canonicalNovelReadScope,
      volumeId,
    )).volume.title,
    forbiddenVolumeTitle,
  );
  assert.equal(
    (await restarted.publicationQueries.getChapter(
      canonicalNovelReadScope,
      chapterId,
    )).chapter.title,
    forbiddenChapterTitle,
  );
  assertRedacted(logs, [root, forbiddenVolumeTitle, forbiddenChapterTitle]);

  console.log("novel publication application smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
