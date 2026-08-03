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
  CharacterChangeReviewer,
  ComposerDraftStore,
  LocationChangeReviewer,
  NovelApp,
} from "../dist/index.js";

const conversationId = "conversation-entity-field-reference";
const draftStore = new ComposerDraftStore();
const shellStore = new ApplicationShellStore({
  workspace: { id: "workspace-1", label: "星海计划" },
  novel: { id: "novel-1", label: "星海纪元" },
  conversation: { id: conversationId, label: "实体审阅" },
});

installDom();
const host = new DeterministicMockNovelHost();
const transport = new MockElectronApiTransport({ host });
const api = new DefaultNovelApiClient({ transport });
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);

await renderReviewer("character");
await selectAndReference("summary");
assert.equal(
  draftStore.getSnapshot(conversationId).references[0].key,
  "character:character-1:summary",
);
assert.equal(draftStore.getSnapshot(conversationId).references[0].kind, "character");

await renderReviewer("location");
assert.equal(container.querySelector(".novel-reference-in-conversation"), null);
await selectAndReference("summary");
assert.deepEqual(
  draftStore.getSnapshot(conversationId).references.map((reference) => reference.key),
  ["character:character-1:summary", "location:location-1:summary"],
);
assert.deepEqual(
  draftStore.getSnapshot(conversationId).references.map((reference) => reference.kind),
  ["character", "location"],
);
assert.equal(
  draftStore.getSnapshot(conversationId).references.at(-1).target.parameters.entityId,
  "location-1",
);

await act(async () => root.unmount());
await transport.close();
await host.close();
console.log("entity field reference smoke passed");

async function renderReviewer(domain) {
  const Component = domain === "character"
    ? CharacterChangeReviewer
    : LocationChangeReviewer;
  const view = createView(domain);
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
        createElement(Component, {
          view,
          referenceForField: (field, currentView) => ({
            key: `${domain}:${currentView.entityId}:${field.fieldId}`,
            kind: domain,
            label: `${currentView.entityName} · ${field.label}`,
            target: {
              key: `${domain}-field:${currentView.entityId}:${field.fieldId}`,
              kind: `${domain}-field-review`,
              title: `${currentView.entityName} · ${field.label}`,
              parameters: {
                entityId: currentView.entityId,
                fieldId: field.fieldId,
              },
            },
          }),
        }),
      ),
    );
  });
}

async function selectAndReference(fieldId) {
  const field = container.querySelector(`[data-field-id="${fieldId}"]`);
  await act(async () => field.click());
  const action = container.querySelector(".novel-reference-in-conversation");
  assert.equal(action.dataset.referenceState, "ready");
  await act(async () => action.click());
  assert.equal(
    container.querySelector(".novel-reference-in-conversation").dataset.referenceState,
    "referenced",
  );
}

function createView(domain) {
  return {
    entityId: domain === "character" ? "character-1" : "location-1",
    entityName: domain === "character" ? "林舟" : "白塔港",
    fields: [
      {
        fieldId: "role",
        label: domain === "character" ? "身份" : "功能",
        kind: "added",
        after: { kind: "text", text: domain === "character" ? "调查记者" : "港口城市" },
      },
      {
        fieldId: "summary",
        label: domain === "character" ? "人物摘要" : "地点摘要",
        kind: "modified",
        before: { kind: "text", text: "旧摘要" },
        after: { kind: "text", text: "新摘要" },
      },
    ],
    evidence: [
      {
        evidenceId: `${domain}-evidence-1`,
        mode: "planned",
        title: "阶段状态",
        sourceStoryUnitIds: ["story-unit-1"],
      },
    ],
  };
}

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
