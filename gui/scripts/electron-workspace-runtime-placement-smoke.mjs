import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../../core/dist/index.js";
import { NodeWorkspaceStoreLocator } from "../../core/dist/node/index.js";
import {
  DesktopNovelWorkspaceApplicationFactory,
  DesktopWorkspaceService,
} from "../dist/main/index.js";

const previousHome = process.env.NOVEL_HOME;
const root = await mkdtemp(join(tmpdir(), "novel-gui-runtime-placement-"));
process.env.NOVEL_HOME = join(root, "home");
let service;
try {
  const workspaceRoot = join(root, "project");
  await mkdir(workspaceRoot, { recursive: true });
  const locator = new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  });
  service = new DesktopWorkspaceService({
    picker: { pickDirectory: async () => workspaceRoot },
    locator,
    applicationFactory: new DesktopNovelWorkspaceApplicationFactory({
      storageRoot: join(root, "storage"),
    }),
  });
  const reference = await service.select(1);
  assert.ok(reference);
  const workspace = await service.open(1, reference);
  assert.ok(workspace);
  const api = new DefaultNovelApiClient({
    transport: service.resolveTransport(1),
  });
  const conversation = await api.conversations.create({
    agent: { agentType: "novel_agent", definitionVersion: "1.0.0" },
  });
  const handle = await api.conversations.open(conversation.id);
  await handle.input.enqueue(
    new UserMessageInputEvent({
      id: "gui-runtime-placement-input",
      timestamp: "2026-08-04T10:00:00.000Z",
      text: "runtime placement probe",
    }),
  );
  await waitUntil(
    async () => (await handle.getRuntimePresence()).state === "crashed",
    "desktop child placement activation failure",
  );
  await service.close(1);
  service = undefined;
} finally {
  process.env.NOVEL_HOME = previousHome;
  await service?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("Electron workspace runtime placement smoke passed");

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for ${label}`);
}
