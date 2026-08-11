/**
 * conversation.mode.set 持久化验收：真实 SqliteWorkspaceStore + ComposeToolService。
 *
 * 覆盖 §10 验收点：
 *   - v7 迁移后新会话 mode 落默认 review；
 *   - setMode(bypass) 持久化，关店重开 hydrate 恢复；
 *   - setMode(compose) 落 conversations.mode=compose + 伴随行(designing, preMode=bypass)；
 *   - 模拟批准 exit() → 行删、mode 回 bypass、compose.applied + mode.changed；
 *   - compose→review discard → 行清、design 文件删、discarded + mode.changed；
 *   - mode=compose + 伴随行 phase=pending → hydrate 恢复为 pending 快照。
 *
 * 写序断言：DB 写是提交点，事件在持久化之后发射（顺序由 sink 收集验证）。
 */
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ComposeModeStateProvider,
  ComposeToolService,
  CoreRuntimeInputLanePolicy,
  InputRouter,
  RUNTIME_INPUT_LANE,
  createCoreEventSchemaRegistry,
} from "../dist/index.js";
import {
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";

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

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-mode-persistence-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const designRoot = join(temporaryRoot, "design");
const logs = [];
const logger = new CollectingLogger(logs);
const registry = createCoreEventSchemaRegistry();
const conversationId = "conversation-mode-persistence";
const sinkEvents = [];

// 回归：conversation.mode.set 必须路由进 control lane（否则被通用 turn 管线拒绝为 invalid_input）。
{
  const laneRouter = new InputRouter({
    conversationId,
    lanePolicy: new CoreRuntimeInputLanePolicy(),
  });
  const routeModeSet = laneRouter.route({
    id: "input-mode-set-lane",
    eventType: "conversation.mode.set",
    conversationId,
    sequence: 1,
    direction: "input",
    recordedAt: "2026-08-08T00:00:00.000Z",
  });
  assert.equal(routeModeSet.lane, RUNTIME_INPUT_LANE.control);
  const routeUserMessage = laneRouter.route({
    id: "input-user-message-lane",
    eventType: "user.message",
    conversationId,
    sequence: 2,
    direction: "input",
    recordedAt: "2026-08-08T00:00:00.000Z",
  });
  assert.equal(routeUserMessage.lane, RUNTIME_INPUT_LANE.turn);
}

/** 只收集事件类型的 sink：验证写序（begin/mode.changed 等按序发射）。 */
const sink = {
  async append(event) {
    sinkEvents.push(event.getEventType());
    return Object.freeze({
      status: "recorded",
      conversationId: event.conversationId,
      eventId: "",
      sequence: 0,
      recordedAt: "",
    });
  },
};

async function openStore(location) {
  return SqliteWorkspaceStore.open({
    workspace: location,
    eventSchemaRegistry: registry,
    logger,
  });
}

/** 每次重建独立 provider + service，镜像重启后的装配（内存态不共享）。 */
function createService(store) {
  const state = new ComposeModeStateProvider({ logger });
  const service = new ComposeToolService({
    composeState: state,
    designRoot,
    eventSink: sink,
    conversations: store.conversations,
    logger,
  });
  return { state, service };
}

let store;
try {
  await mkdir(workspaceRoot, { recursive: true });
  const location = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  store = await openStore(location);

  // ① 迁移后新会话 mode 默认 review。
  const created = await store.conversations.createConversation({
    id: conversationId,
    workspaceId: location.workspaceId,
    agent: { agentType: "novel.main", definitionVersion: "1" },
  });
  assert.equal(created.metadata.mode, "review");
  assert.equal(
    (await store.conversations.getConversationComposeState(conversationId)),
    undefined,
    "新会话无 compose 伴随行",
  );

  let { state, service } = createService(store);

  // ② setMode(bypass)：DB 落库 + 单条 mode.changed。
  await service.setMode(conversationId, "bypass");
  assert.equal(
    (await store.conversations.getConversationMetadata(conversationId)).mode,
    "bypass",
  );
  const bypassSnapshot = state.snapshot(conversationId);
  assert.equal(bypassSnapshot.mode, "bypass");
  assert.equal(bypassSnapshot.active, false);
  assert.deepEqual(sinkEvents, ["novel.mode.changed"]);
  sinkEvents.length = 0;

  // ③ 关店重开 + hydrate：mode 从 DB 恢复（不依赖事件）。
  await store.close();
  store = await openStore(location);
  ({ state, service } = createService(store));
  await service.hydrate(conversationId);
  assert.equal(state.snapshot(conversationId).mode, "bypass");
  assert.equal(state.snapshot(conversationId).active, false);

  // ④ setMode(compose) → begin：mode=compose + 伴随行(designing, preMode=bypass)。
  await service.setMode(conversationId, "compose");
  const composeSnapshot = state.snapshot(conversationId);
  assert.equal(composeSnapshot.active, true);
  assert.equal(composeSnapshot.phase, "designing");
  assert.equal(composeSnapshot.mode, "compose");
  assert.equal(composeSnapshot.preComposeMode, "bypass");
  assert.equal(
    (await store.conversations.getConversationMetadata(conversationId)).mode,
    "compose",
  );
  const composeRow =
    await store.conversations.getConversationComposeState(conversationId);
  assert.equal(composeRow.phase, "designing");
  assert.equal(composeRow.preMode, "bypass");
  assert.equal(composeRow.designFilePath, service.designFilePathFor(conversationId));
  assert.equal(composeRow.purpose, undefined, "setMode(compose) 无 purpose");
  assert.deepEqual(sinkEvents, ["novel.compose.begin", "novel.mode.changed"]);
  sinkEvents.length = 0;
  await access(service.designFilePathFor(conversationId));

  // ⑤ 模拟批准 exit()：行删、mode 回 bypass、applied + mode.changed。
  await service.exit(conversationId);
  const appliedSnapshot = state.snapshot(conversationId);
  assert.equal(appliedSnapshot.phase, "applied");
  assert.equal(appliedSnapshot.active, false);
  assert.equal(appliedSnapshot.mode, "bypass");
  assert.equal(
    (await store.conversations.getConversationMetadata(conversationId)).mode,
    "bypass",
  );
  assert.equal(
    await store.conversations.getConversationComposeState(conversationId),
    undefined,
    "exit 后伴随行删除",
  );
  assert.deepEqual(sinkEvents, ["novel.compose.applied", "novel.mode.changed"]);
  sinkEvents.length = 0;

  // ⑥ compose → review 用户主动切走（discard 路径）：行清、design 文件删。
  await service.setMode(conversationId, "compose");
  const designFilePath = service.designFilePathFor(conversationId);
  await access(designFilePath);
  sinkEvents.length = 0;
  await service.setMode(conversationId, "review");
  const reviewSnapshot = state.snapshot(conversationId);
  assert.equal(reviewSnapshot.mode, "review");
  assert.equal(reviewSnapshot.active, false);
  assert.equal(
    (await store.conversations.getConversationMetadata(conversationId)).mode,
    "review",
  );
  assert.equal(
    await store.conversations.getConversationComposeState(conversationId),
    undefined,
    "discard 后伴随行清除",
  );
  assert.deepEqual(sinkEvents, ["novel.compose.discarded", "novel.mode.changed"]);
  sinkEvents.length = 0;
  await assert.rejects(access(designFilePath));

  // ⑦ mode=compose + 伴随行 phase=pending → hydrate 恢复为 pending 快照。
  await service.setMode(conversationId, "compose");
  state.submit(conversationId);
  await store.conversations.setConversationComposeState(conversationId, {
    phase: "pending",
    designFilePath: service.designFilePathFor(conversationId),
    preMode: "bypass",
    updatedAt: "2026-08-02T04:00:00.000Z",
  });
  await store.close();
  store = await openStore(location);
  ({ state, service } = createService(store));
  await service.hydrate(conversationId);
  const pendingSnapshot = state.snapshot(conversationId);
  assert.equal(pendingSnapshot.active, true);
  assert.equal(pendingSnapshot.phase, "pending");
  assert.equal(pendingSnapshot.mode, "compose");
  assert.equal(pendingSnapshot.preComposeMode, "bypass");

  // ⑧ purpose 持久化贯通：begin(purpose) → snapshot + DB 行 → 重启 hydrate 恢复。
  sinkEvents.length = 0;
  await service.discard(conversationId);
  await service.begin(conversationId, "第三章大纲");
  assert.equal(state.snapshot(conversationId).purpose, "第三章大纲");
  const purposeRow =
    await store.conversations.getConversationComposeState(conversationId);
  assert.equal(purposeRow.purpose, "第三章大纲");
  await store.close();
  store = await openStore(location);
  ({ state, service } = createService(store));
  await service.hydrate(conversationId);
  assert.equal(state.snapshot(conversationId).phase, "designing");
  assert.equal(state.snapshot(conversationId).purpose, "第三章大纲");
} finally {
  if (store) await store.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("conversation mode set persistence smoke passed");
