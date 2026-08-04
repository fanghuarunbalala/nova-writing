import assert from "node:assert/strict";
import { access, mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  API_PROTOCOL_VERSION,
  NOVEL_QUERY_API_OPERATION,
  DefaultNovelApiClient,
} from "../../core/dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
} from "../../core/dist/node/index.js";
import {
  DesktopNovelWorkspaceApplicationFactory,
  DesktopWorkspaceService,
} from "../dist/main/index.js";

const root = await mkdtemp(join(tmpdir(), "novel-electron-conversation-host-"));
const workspaceRoot = join(root, "desktop-project");
await mkdir(workspaceRoot, { recursive: true });

const locator = new NodeWorkspaceStoreLocator({
  storageRoot: join(root, "storage"),
});
const service = new DesktopWorkspaceService({
  picker: { pickDirectory: async () => workspaceRoot },
  locator,
  applicationFactory: new DesktopNovelWorkspaceApplicationFactory(),
});
const reference = await service.select(1);
assert.ok(reference);
const workspace = await service.open(1, reference);
const transport = service.resolveTransport(1);
assert.ok(transport);
const workspaceLocation = await locator.getByWorkspaceId(workspace.id);
assert.ok(workspaceLocation);
await access(workspaceLocation.databasePath);
await access(
  (await new NodeNovelStoreLocator().resolve(workspaceLocation))
    .canonicalDatabasePath,
);

const api = new DefaultNovelApiClient({ transport });
const conversation = await api.conversations.create({
  agent: { agentType: "novel_agent", definitionVersion: "1.0.0" },
});
const listed = await api.conversations.list();
assert.equal(listed.conversations.length, 1);
assert.equal(listed.conversations[0].metadata.id, conversation.id);
assert.equal(listed.conversations[0].metadata.workspaceId, workspace.id);
const novelOverview = await transport.request({
  protocolVersion: API_PROTOCOL_VERSION,
  requestId: "electron-novel-overview",
  operation: NOVEL_QUERY_API_OPERATION.overviewGet,
  payload: { scope: { kind: "canonical" } },
});
assert.equal(novelOverview.ok, true);
assert.equal(novelOverview.data.workspaceId, workspace.id);
assert.deepEqual(novelOverview.data.counts, {
  storyUnitCount: 0,
  characterCount: 0,
  locationCount: 0,
  volumeCount: 0,
  chapterCount: 0,
  manuscriptBlockCount: 0,
});

await service.close(1);
assert.equal(service.resolveTransport(1), undefined);
await service.open(1, { referenceId: workspace.id, label: workspace.label });
const reopenedTransport = service.resolveTransport(1);
assert.ok(reopenedTransport);
const reopenedApi = new DefaultNovelApiClient({ transport: reopenedTransport });
const recovered = await reopenedApi.conversations.list();
assert.equal(recovered.conversations.length, 1);
assert.equal(recovered.conversations[0].metadata.id, conversation.id);

await service.releaseSender(1);
console.log("electron conversation host smoke passed");
