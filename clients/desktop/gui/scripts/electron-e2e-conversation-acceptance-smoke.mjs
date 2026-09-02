import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../../core/dist/index.js";
import {
  DESKTOP_CHILD_STORAGE_ROOT_ENV,
  NodeWorkspaceStoreLocator,
  createChildProcessConversationRuntimePlacement,
} from "../../core/dist/node/index.js";
import {
  DesktopNovelWorkspaceApplicationFactory,
} from "../dist/main/index.js";

const root = await mkdtemp(join(tmpdir(), "novel-e2e-acceptance-"));
let application;
let placement;
const parentLogs = [];
const parentLogger = {
  debug: (event, fields = {}) => parentLogs.push(`DEBUG ${event} ${JSON.stringify(fields)}`),
  info: (event, fields = {}) => parentLogs.push(`INFO ${event} ${JSON.stringify(fields)}`),
  warn: (event, fields = {}) => parentLogs.push(`WARN ${event} ${JSON.stringify(fields)}`),
  error: (event, fields = {}) => parentLogs.push(`ERROR ${event} ${JSON.stringify(fields)}`),
  child: () => parentLogger,
};
try {
  const workspaceRoot = join(root, "project");
  const storageRoot = join(root, "storage");
  await mkdir(workspaceRoot, { recursive: true });
  const location = await new NodeWorkspaceStoreLocator({
    storageRoot,
  }).resolve(workspaceRoot);
  const fixturePath = fileURLToPath(
    new URL(
      "../../core/scripts/fixtures/runtime-desktop-child-e2e.mjs",
      import.meta.url,
    ),
  );
  placement = createChildProcessConversationRuntimePlacement({
    command: process.execPath,
    args: [fixturePath],
    env: { [DESKTOP_CHILD_STORAGE_ROOT_ENV]: storageRoot },
    persistenceProvider: {
      provide: async (bootstrap) => {
        if (application === undefined) {
          throw new TypeError("application is not open");
        }
        return application.getRuntimePersistence(
          bootstrap.conversation.metadata.id,
        );
      },
    },
    logger: parentLogger,
  });
  const factory = new DesktopNovelWorkspaceApplicationFactory({
    storageRoot,
    placement,
    logger: parentLogger,
  });

  application = await factory.open(location);
  let api = new DefaultNovelApiClient({ transport: application.transport });
  const conversation = await api.conversations.create({
    agent: { agentType: "novel", definitionVersion: "1.0.0" },
  });
  const handle = await api.conversations.open(conversation.id);
  await handle.input.enqueue(
    new UserMessageInputEvent({
      id: "e2e-acceptance-input",
      timestamp: "2026-08-04T12:00:00.000Z",
      text: "e2e acceptance input",
    }),
  );
  await waitUntil(
    async () => {
      const presence = await handle.getRuntimePresence();
      return presence.state === "online";
    },
    "desktop child runtime online",
  );
  await waitUntil(
    async () => {
      const replay = await handle.events.list({
        anchor: { from: "start" },
        limit: 100,
      });
      return replay.events.some(
        (event) => event.eventType === "agent.run.state.changed",
      );
    },
    "durable output event in journal",
  );

  try {
    await application.close();
  } catch (error) {
    console.error("E2E CLOSE ERROR", error);
    console.error("E2E PARENT LOG\n", parentLogs.join("\n"));
    throw error;
  }
  assert.equal(placement.activeProcessCount, 0);
  application = await factory.open(location);
  api = new DefaultNovelApiClient({ transport: application.transport });
  const replayed = await api.conversations.open(conversation.id);
  const replayPage = await replayed.events.list({
    anchor: { from: "start" },
    limit: 100,
  });
  assert.equal(
    replayPage.events.some(
      (event) => event.eventType === "agent.run.state.changed",
    ),
    true,
  );
  assert.equal((await replayed.getRuntimePresence()).state, "offline");
  await replayed.close();
} finally {
  await application?.close();
  await placement?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("Electron E2E conversation acceptance smoke passed");

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Timed out waiting for ${label}`);
}
