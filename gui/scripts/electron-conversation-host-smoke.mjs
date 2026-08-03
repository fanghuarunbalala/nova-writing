import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultNovelApiClient } from "../../core/dist/index.js";
import { NodeWorkspaceStoreLocator } from "../../core/dist/node/index.js";
import {
  DesktopConversationApiApplicationFactory,
  DesktopWorkspaceService,
} from "../dist/main/index.js";

const root = await mkdtemp(join(tmpdir(), "novel-electron-conversation-host-"));
const workspaceRoot = join(root, "desktop-project");
await mkdir(workspaceRoot, { recursive: true });

const service = new DesktopWorkspaceService({
  picker: { pickDirectory: async () => workspaceRoot },
  locator: new NodeWorkspaceStoreLocator({ storageRoot: join(root, "storage") }),
  applicationFactory: new DesktopConversationApiApplicationFactory(),
});
const reference = await service.select(1);
assert.ok(reference);
const workspace = await service.open(1, reference);
const transport = service.resolveTransport(1);
assert.ok(transport);

const api = new DefaultNovelApiClient({ transport });
const conversation = await api.conversations.create({
  agent: { agentType: "novel_agent", definitionVersion: "1.0.0" },
});
const listed = await api.conversations.list();
assert.equal(listed.conversations.length, 1);
assert.equal(listed.conversations[0].metadata.id, conversation.id);
assert.equal(listed.conversations[0].metadata.workspaceId, workspace.id);

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
