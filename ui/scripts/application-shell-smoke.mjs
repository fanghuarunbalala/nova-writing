import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DefaultNovelApiClient } from "../../core/dist/index.js";
import {
  DeterministicMockNovelHost,
  MockElectronApiTransport,
} from "../../core/dist/testing/index.js";
import { NovelApp } from "../dist/index.js";

const host = new DeterministicMockNovelHost();
const transport = new MockElectronApiTransport({ host });
const api = new DefaultNovelApiClient({ transport });
const platform = createPlatform();

function DesktopTitleBar() {
  return createElement("div", { "data-desktop-titlebar": "true" }, "Novel");
}

const markup = renderToStaticMarkup(
  createElement(
    NovelApp,
    {
      api,
      platform,
      extensions: { titleBar: DesktopTitleBar },
      shell: {
        context: {
          workspace: "星海计划",
          meta: "主线大纲",
          conversation: "开篇讨论",
          agent: "Novel Main",
        },
        conversations: [
          { id: "conversation-1", title: "开篇讨论", active: true },
          { id: "conversation-2", title: "人物动机" },
        ],
        inspectorMode: "normal",
        inspector: createElement("div", null, "大纲详情"),
        composer: createElement("div", null, "Composer Slot"),
      },
    },
    createElement("div", { "data-timeline": "true" }, "Timeline Slot"),
  ),
);

for (const label of ["项目", "编辑", "发布", "帮助"]) {
  assert.match(markup, new RegExp(`>${label}<`));
}
for (const label of ["新对话", "安排", "大纲", "人物", "地点", "正文"]) {
  assert.match(markup, new RegExp(`>${label}<`));
}
assert.match(markup, /星海计划/);
assert.match(markup, /开篇讨论/);
assert.equal(markup.includes("主线大纲"), false);
assert.equal(markup.includes("Novel Main"), false);
assert.match(markup, /data-inspector-mode="normal"/);
assert.match(markup, /aria-label="项目导航"/);
assert.match(markup, /aria-label="对话工作区"/);
assert.match(markup, /aria-label="内容检查器"/);
assert.match(markup, /data-desktop-titlebar="true"/);
assert.match(markup, /data-timeline="true"/);
assert.match(markup, /Composer Slot/);
assert.match(markup, /--novel-surface-primary: #ffffff/);
assert.match(markup, /grid-template-areas:/);
assert.match(markup, /"titlebar"/);
assert.match(markup, /"menu"/);
assert.match(markup, /"context"/);
assert.match(markup, /"body"/);
assert.match(markup, /\.novel-shell-body \{[\s\S]*grid-area: body/);
assert.match(markup, /height: 100dvh/);
assert.match(markup, /min-width: 0/);
assert.match(markup, /@media \(max-width: 720px\)/);

const closedMarkup = renderToStaticMarkup(
  createElement(NovelApp, { api, platform }),
);
assert.match(closedMarkup, /data-inspector-mode="closed"/);
assert.match(closedMarkup, /aria-hidden="true"/);
assert.match(closedMarkup, /选择 Workspace/);

await transport.close();
await host.close();
console.log("application shell smoke passed");

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
