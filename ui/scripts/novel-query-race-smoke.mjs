import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { NovelApp } from "../dist/index.js";

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
      workspace: { id: "workspace_ui_race", label: "白昼计划" },
    },
  }));
});

await waitForReact(() => sidebarDetail("人物") === "1");

await clickButton("人物");
await waitForReact(() => container.textContent.includes("正在读取内容"));

await clickButton("大纲");
await waitForReact(() => container.querySelector(".novel-outline-row") !== null);
assert.match(container.textContent, /第一幕/);

api.resolveCharacters();
await waitForReact(() => api.charactersResolved);
assert.equal(container.textContent.includes("林澈"), false);
assert.match(container.textContent, /第一幕/);
assert.equal(container.textContent.includes("内容读取失败"), false);

await act(async () => reactRoot.unmount());
console.log("novel query race smoke passed");

function createApi() {
  let resolveCharacters;
  const charactersPromise = new Promise((resolve) => {
    resolveCharacters = resolve;
  });
  let charactersResolved = false;
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
    aliases: [],
    summary: "主角",
    authorNotes: "保持克制",
    entityVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    get charactersResolved() {
      return charactersResolved;
    },
    resolveCharacters: () => {
      resolveCharacters({
        schemaVersion: 1,
        scope,
        characters: [character],
      });
      charactersResolved = true;
    },
    conversations: {
      create: async () => { throw new Error("not used"); },
      list: async () => ({ conversations: [] }),
      open: async () => { throw new Error("not used"); },
    },
    novel: {
      overview: {
        get: async () => ({
          schemaVersion: 1,
          scope,
          workspaceId: "workspace_ui_race",
          novelId: "novel_ui_race",
          novelSchemaVersion: 10,
          sourceRevision: "revision_ui_race",
          counts: {
            storyUnitCount: 1,
            characterCount: 1,
            locationCount: 0,
            volumeCount: 1,
            chapterCount: 1,
            manuscriptBlockCount: 1,
          },
          roots: {
            outlineAvailable: true,
            publicationAvailable: true,
            manuscriptAvailable: true,
          },
        }),
      },
      outline: {
        get: async () => ({
          schemaVersion: 1,
          scope,
          tree: {
            outline: { id: "outline_main", novelId: "novel_ui_race" },
            units: [unit],
          },
          progress: [progress],
        }),
        getStoryUnit: async () => ({ schemaVersion: 1, scope, unit, progress }),
      },
      characters: {
        list: async () => charactersPromise,
        get: async () => ({ schemaVersion: 1, scope, character }),
      },
      locations: {
        list: async () => ({ schemaVersion: 1, scope, locations: [] }),
        get: async () => ({ schemaVersion: 1, scope, location: undefined }),
      },
      manuscript: {
        getStructure: async () => ({
          schemaVersion: 1,
          scope,
          publication: undefined,
          manuscript: undefined,
          blocks: [],
        }),
        getBlock: async () => ({ schemaVersion: 1, scope, readModel: undefined }),
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
