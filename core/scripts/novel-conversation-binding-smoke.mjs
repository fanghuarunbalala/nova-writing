import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConversationNovelBindingService,
  NovelDraftSessionService,
  captureNovelDraftSessionId,
  captureNovelTimestamp,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteConversationNovelBindingStore,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftStore,
  SqliteNovelSnapshotter,
} from "../dist/node/index.js";

class Clock {
  offset = 0;
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 2, 6, 0, 0, this.offset++)).toISOString(),
    );
  }
}
class IdentityFactory {
  createDraftSessionId() {
    return captureNovelDraftSessionId("draft_conversation_binding");
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-conversation-binding-"));
let canonicalStore;
let draftStore;
let bindingStore;
try {
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  const clock = new Clock();
  canonicalStore = await SqliteNovelCanonicalStore.open({ location, clock });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({ location, novelId: canonical.novelId });
  const draftService = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({ location, novelId: canonical.novelId }),
    identityFactory: new IdentityFactory(),
    clock,
  });
  const draft = await draftService.startDraft("conversation-binding");
  bindingStore = await SqliteConversationNovelBindingStore.open({
    location,
    novelId: canonical.novelId,
  });
  const service = new ConversationNovelBindingService(canonical.novelId, bindingStore, clock);
  const novelOnly = await service.bind("conversation-binding");
  assert.equal(novelOnly.activeDraftSessionId, undefined);
  const attached = await service.bindActiveDraft(draft);
  assert.equal(attached.activeDraftSessionId, draft.id);
  await bindingStore.close();
  bindingStore = await SqliteConversationNovelBindingStore.open({
    location,
    novelId: canonical.novelId,
  });
  const restarted = new ConversationNovelBindingService(canonical.novelId, bindingStore, clock);
  assert.deepEqual(await restarted.get("conversation-binding"), attached);
  await assert.rejects(() => restarted.bindActiveDraft({ ...draft, ownerConversationId: "conversation-other" }));
  const cleared = await restarted.clearActiveDraft("conversation-binding", draft.id);
  assert.equal(cleared.activeDraftSessionId, undefined);
} finally {
  await bindingStore?.close();
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
console.log("novel conversation binding smoke passed");
