import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { NovelApp, createNovelReadCache } from "../dist/index.js";

installDom();
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const reactRoot = createRoot(container);
const api = createApi();

await act(async () => {
  reactRoot.render(createElement(NovelApp, {
    api,
    platform: createPlatform(),
    initialShellState: {
      workspace: { id: "workspace_ui_cache", label: "白昼计划" },
    },
  }));
});

await waitForReact(() => sidebarDetail("人物") === "1");
assert.equal(api.counts.overview, 1);

await clickButton("人物");
await waitForReact(() => queryIndexButton("林澈") !== undefined);
assert.equal(api.counts.characters, 1);

await clickButton("大纲");
await waitForReact(() => container.querySelector(".novel-outline-row") !== null);
assert.equal(api.counts.outline, 1);

await clickButton("人物");
await waitForReact(() => queryIndexButton("林澈") !== undefined);
assert.equal(api.counts.characters, 1);

await act(async () => queryIndexButton("林澈").click());
await waitForReact(() => container.textContent.includes("作者备注"));
assert.equal(api.counts.character, 1);

await clickButton("人物");
await waitForReact(() => queryIndexButton("林澈") !== undefined);
assert.equal(api.counts.characters, 1);
await act(async () => queryIndexButton("林澈").click());
await waitForReact(() => container.textContent.includes("作者备注"));
assert.equal(api.counts.character, 1);

await clickButton("正文");
await waitForReact(() => queryIndexButton("段落 1") !== undefined);
assert.equal(api.counts.manuscriptStructure, 1);
await act(async () => queryIndexButton("段落 1").click());
await waitForReact(() => container.textContent.includes("雨落在站台上。"));
assert.equal(api.counts.manuscriptBlock, 1);

await clickButton("人物");
await waitForReact(() => queryIndexButton("林澈") !== undefined);
await clickButton("正文");
await waitForReact(() => queryIndexButton("段落 1") !== undefined);
assert.equal(api.counts.manuscriptStructure, 1);
assert.equal(api.counts.characters, 1);

assert.equal(api.conversationCalls, 0);
assert.deepEqual([...new Set(api.scopes)].sort(), ["canonical"]);
assert.equal(container.textContent.includes("SQLite"), false);

const cache = createNovelReadCache();
cache.noteRevision("revision_one");
cache.set("canonical:characters", Object.freeze({ ok: true }));
assert.deepEqual(cache.get("canonical:characters"), { ok: true });
cache.noteRevision("revision_two");
assert.equal(cache.get("canonical:characters"), undefined);
cache.set("canonical:characters", Object.freeze({ ok: true }));
cache.clear();
assert.equal(cache.get("canonical:characters"), undefined);

await act(async () => reactRoot.unmount());
console.log("novel read cache smoke passed");

function createApi() {
  const counts = {
    overview: 0,
    outline: 0,
    storyUnit: 0,
    characters: 0,
    character: 0,
    locations: 0,
    location: 0,
    manuscriptStructure: 0,
    manuscriptBlock: 0,
  };
  const scopes = [];
  let conversationCalls = 0;
  const timestamp = "2026-08-04T00:00:00.000Z";
  const scope = { kind: "canonical" };
  const unit = {
    id: "story_unit_root",
    outlineId: "outline_main",
    orderKey: "8000",
    title: "第一幕",
    intent: "雨夜相遇",
    scope: "arc",
    planningStatus: "ready",
    realizationStatus: "pending",
  };
  const progress = {
    storyUnitId: unit.id,
    effectiveStatus: "pending",
    isBlocked: false,
    isDirectlyBlocked: false,
    isBlockedByAncestor: false,
    blockedLeafCount: 0,
    completedLeafCount: 0,
    totalLeafCount: 1,
  };
  const character = {
    id: "character_primary",
    name: "林澈",
    aliases: ["小林"],
    summary: "主角",
    authorNotes: "保持克制",
    entityVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const location = {
    id: "location_station",
    name: "旧车站",
    aliases: [],
    summary: "雨夜入口",
    initialState: "废弃",
    entityVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const publication = {
    publication: { id: "publication_main", novelId: "novel_ui_cache" },
    volumes: [{
      id: "volume_one",
      publicationId: "publication_main",
      orderKey: "8000",
      title: "第一卷",
      primaryStoryUnitId: unit.id,
    }],
    chapters: [{
      id: "chapter_one",
      publicationId: "publication_main",
      volumeId: "volume_one",
      orderKey: "8000",
      title: "雨夜",
    }],
  };
  const manuscript = {
    id: "manuscript_main",
    novelId: "novel_ui_cache",
    publicationId: "publication_main",
  };
  const block = {
    id: "block_opening",
    manuscriptId: manuscript.id,
    chapterId: "chapter_one",
    orderKey: "8000",
    text: "雨落在站台上。",
  };
  const overview = () => {
    counts.overview += 1;
    scopes.push(scope.kind);
    return {
      schemaVersion: 1,
      scope,
      workspaceId: "workspace_ui_cache",
      novelId: "novel_ui_cache",
      novelSchemaVersion: 10,
      sourceRevision: "revision_ui_cache",
      counts: {
        storyUnitCount: 1,
        characterCount: 1,
        locationCount: 1,
        volumeCount: 1,
        chapterCount: 1,
        manuscriptBlockCount: 1,
      },
      roots: {
        outlineAvailable: true,
        publicationAvailable: true,
        manuscriptAvailable: true,
      },
    };
  };
  return {
    counts,
    scopes,
    get conversationCalls() {
      return conversationCalls;
    },
    conversations: {
      create: async () => {
        conversationCalls += 1;
        throw new Error("not used");
      },
      list: async () => {
        conversationCalls += 1;
        return { conversations: [] };
      },
      open: async () => {
        conversationCalls += 1;
        throw new Error("not used");
      },
    },
    novel: {
      overview: {
        get: async () => overview(),
      },
      outline: {
        get: async () => {
          counts.outline += 1;
          scopes.push(scope.kind);
          return {
            schemaVersion: 1,
            scope,
            tree: {
              outline: { id: "outline_main", novelId: "novel_ui_cache" },
              units: [unit],
            },
            progress: [progress],
          };
        },
        getStoryUnit: async (_scope, storyUnitId) => {
          counts.storyUnit += 1;
          scopes.push(scope.kind);
          return { schemaVersion: 1, scope, unit, progress };
        },
      },
      characters: {
        list: async () => {
          counts.characters += 1;
          scopes.push(scope.kind);
          return { schemaVersion: 1, scope, characters: [character] };
        },
        get: async (_scope, characterId) => {
          counts.character += 1;
          scopes.push(scope.kind);
          return { schemaVersion: 1, scope, character };
        },
      },
      locations: {
        list: async () => {
          counts.locations += 1;
          scopes.push(scope.kind);
          return { schemaVersion: 1, scope, locations: [location] };
        },
        get: async (_scope, locationId) => {
          counts.location += 1;
          scopes.push(scope.kind);
          return { schemaVersion: 1, scope, location };
        },
      },
      manuscript: {
        getStructure: async () => {
          counts.manuscriptStructure += 1;
          scopes.push(scope.kind);
          return {
            schemaVersion: 1,
            scope,
            publication,
            manuscript,
            blocks: [{
              id: block.id,
              chapterId: block.chapterId,
              orderKey: block.orderKey,
              textLength: block.text.length,
              textDigest: "a".repeat(64),
            }],
          };
        },
        getBlock: async (_scope, blockId) => {
          counts.manuscriptBlock += 1;
          scopes.push(scope.kind);
          return {
            schemaVersion: 1,
            scope,
            readModel: {
              block,
              textDigest: "a".repeat(64),
              chapterDigest: "b".repeat(64),
              orderDigest: "c".repeat(64),
            },
          };
        },
      },
    },
  };
}

function sidebarDetail(label) {
  const button = sidebarButton(label);
  return button?.querySelector(".novel-sidebar-detail")?.textContent;
}

function sidebarButton(label) {
  return [...container.querySelectorAll(".novel-sidebar-button")].find(
    (candidate) => candidate.querySelector(".novel-sidebar-label")?.textContent === label,
  );
}

function queryIndexButton(label) {
  return [...container.querySelectorAll(".novel-query-index-button")].find(
    (candidate) => candidate.textContent.includes(label),
  );
}

async function clickButton(label) {
  const button = sidebarButton(label) ?? [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent.includes(label),
  );
  assert.ok(button, `missing button: ${label}`);
  await act(async () => button.click());
}

async function waitForReact(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for React state");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    pretendToBeVisual: true,
  });
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
