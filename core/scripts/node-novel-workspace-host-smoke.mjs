import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_LIFECYCLE_PUBLICATION_STATUS,
  captureNovelTimestamp,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeNovelWorkspaceHost,
  NodeWorkspaceStoreLocator,
} from "../dist/node/index.js";

const root = await mkdtemp(join(tmpdir(), "node-novel-workspace-host-"));
const workspaceRoot = join(root, "workspace");
const published = [];
let sequence = 0;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const publisher = {
    async publish(record) {
      sequence += 1;
      published.push(record);
      return {
        status: NOVEL_LIFECYCLE_PUBLICATION_STATUS.recorded,
        conversationId: record.conversationId,
        eventId: record.eventId,
        sequence,
        recordedAt: captureNovelTimestamp(
          new Date(Date.UTC(2026, 7, 3, 12, 0, sequence)).toISOString(),
        ),
      };
    },
  };
  const readinessPolicy = {
    evaluateCharacter() { return []; },
    evaluateLocation() { return []; },
  };

  const first = await NodeNovelWorkspaceHost.open({
    workspace,
    lifecyclePublisher: publisher,
    readinessPolicy,
  });
  assert.equal(first.workspaceId, workspace.workspaceId);
  assert.equal(first.recoveryResult.phases.length, 5);
  const firstNovelId = first.novelId;
  await first.drafts.startDraft("conversation_workspace_host");
  await first.close();
  await first.close();

  const location = await new NodeNovelStoreLocator().resolve(workspace);
  await access(location.canonicalDatabasePath);

  const reopened = await NodeNovelWorkspaceHost.open({
    workspace,
    lifecyclePublisher: publisher,
    readinessPolicy,
  });
  assert.equal(reopened.novelId, firstNovelId);
  assert.equal((await reopened.getMetadata()).novelId, firstNovelId);
  assert.equal(
    published.some((record) =>
      record.conversationId === "conversation_workspace_host"
    ),
    true,
  );
  await reopened.close();
  console.log("node novel workspace host smoke passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
