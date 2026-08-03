import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { DefaultNovelApiClient } from "../../core/dist/index.js";
import {
  DeterministicMockNovelHost,
  MockElectronApiTransport,
} from "../../core/dist/testing/index.js";
import {
  ApplicationShellStore,
  ComposerDraftStore,
  NovelApp,
  NovelChangeReviewShell,
} from "../dist/index.js";

const conversationId = "conversation-operation-reference";
const digest = `sha256:${"d".repeat(64)}`;
const view = {
  target: {
    approvalRequestId: "approval-1",
    novelId: "novel-1",
    draftSessionId: "draft-1",
    baseRevision: "revision-4",
    changeSetDigest: digest,
    operationIds: ["operation-1", "operation-2"],
    domain: "outline",
  },
  title: "灯塔调查线调整",
  lifecycle: { state: "ready" },
};
const observedBindings = [];
const draftStore = new ComposerDraftStore();
const shellStore = new ApplicationShellStore({
  workspace: { id: "workspace-1", label: "星海计划" },
  novel: { id: "novel-1", label: "星海纪元" },
  conversation: { id: conversationId, label: "变更审阅" },
});

installDom();
const host = new DeterministicMockNovelHost();
const transport = new MockElectronApiTransport({ host });
const api = new DefaultNovelApiClient({ transport });
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
await act(async () => {
  root.render(
    createElement(
      NovelApp,
      {
        api,
        platform: createPlatform(),
        shellStore,
        composerDraftStore: draftStore,
      },
      createElement(NovelChangeReviewShell, {
        view,
        referenceForOperation: (operationId, capturedView) => {
          observedBindings.push({
            operationId,
            draftSessionId: capturedView.target.draftSessionId,
            digest: capturedView.target.changeSetDigest,
          });
          return {
            key: `novel-operation:${capturedView.target.draftSessionId}:${operationId}:${capturedView.target.changeSetDigest}`,
            kind: "novel-operation",
            label: `操作 ${operationId}`,
            target: {
              key: `novel-operation:${operationId}`,
              kind: "novel-operation-review",
              title: `操作 ${operationId}`,
              parameters: {
                draftSessionId: capturedView.target.draftSessionId,
                operationId,
                changeSetDigest: capturedView.target.changeSetDigest,
              },
            },
          };
        },
      }),
    ),
  );
});

const operationRows = [...container.querySelectorAll(".novel-change-review-operations li")];
assert.equal(operationRows.length, 2);
assert.deepEqual(observedBindings, [
  { operationId: "operation-1", draftSessionId: "draft-1", digest },
  { operationId: "operation-2", draftSessionId: "draft-1", digest },
]);

for (const row of operationRows) {
  const action = row.querySelector(".novel-reference-in-conversation");
  assert.equal(action.dataset.referenceState, "ready");
  await act(async () => action.click());
  assert.equal(action.dataset.referenceState, "referenced");
}
assert.deepEqual(
  draftStore.getSnapshot(conversationId).references.map((reference) => ({
    kind: reference.kind,
    operationId: reference.target.parameters.operationId,
    digest: reference.target.parameters.changeSetDigest,
  })),
  [
    { kind: "novel-operation", operationId: "operation-1", digest },
    { kind: "novel-operation", operationId: "operation-2", digest },
  ],
);
assert.match(container.querySelector(".novel-change-review-footer").textContent, /只读/);

await act(async () => root.unmount());
await transport.close();
await host.close();
console.log("novel operation reference smoke passed");

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { pretendToBeVisual: true },
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

function createPlatform() {
  return Object.freeze({
    capabilities: Object.freeze({
      fileSelection: false,
      clipboardRead: false,
      clipboardWrite: false,
      notifications: false,
    }),
    files: Object.freeze({ selectFiles: async () => Object.freeze([]) }),
    clipboard: Object.freeze({
      readText: async () => "",
      writeText: async () => undefined,
    }),
    notifications: Object.freeze({ show: async () => undefined }),
  });
}
