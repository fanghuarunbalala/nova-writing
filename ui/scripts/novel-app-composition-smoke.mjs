import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DefaultNovelApiClient } from "../../core/dist/index.js";
import {
  DeterministicMockNovelHost,
  MockElectronApiTransport,
  MockHttpWebSocketApiTransport,
} from "../../core/dist/testing/index.js";
import { DesktopNovelApp } from "../../gui/dist/renderer/index.js";
import { WebNovelApp } from "../../web/dist/index.js";
import {
  useFrontendPlatform,
  useNovelApi,
  useNovelUiExtensions,
} from "../dist/index.js";

const shellCases = [
  ["desktop", DesktopNovelApp, MockElectronApiTransport],
  ["web", WebNovelApp, MockHttpWebSocketApiTransport],
];

for (const [name, Shell, Transport] of shellCases) {
  await runShellContract(name, Shell, Transport);
}

await assertDuplicateExtensionIdsRejected();
console.log("novel app composition smoke passed");

async function runShellContract(name, Shell, Transport) {
  const host = new DeterministicMockNovelHost();
  const transport = new Transport({ host });
  const api = new DefaultNovelApiClient({ transport });
  const platform = createPlatform(name);
  const extensions = {
    commands: [
      {
        id: `${name}.refresh`,
        label: "Refresh",
        execute: () => undefined,
      },
    ],
  };

  function CompositionProbe() {
    const apiContext = useNovelApi();
    const platformContext = useFrontendPlatform();
    const extensionContext = useNovelUiExtensions();
    assert.equal(apiContext.api, api);
    assert.equal(platformContext, platform);
    assert.ok(Object.isFrozen(extensionContext));
    assert.ok(Object.isFrozen(extensionContext.commands));
    assert.ok(Object.isFrozen(extensionContext.commands?.[0]));
    return createElement("div", {
      "data-shell": name,
      "data-file-selection": String(
        platformContext.capabilities.fileSelection,
      ),
      "data-command": extensionContext.commands?.[0]?.id,
    });
  }

  const markup = renderToStaticMarkup(
    createElement(
      Shell,
      { api, platform, extensions },
      createElement(CompositionProbe),
    ),
  );
  assert.match(markup, new RegExp(`data-shell="${name}"`));
  assert.match(markup, /data-file-selection="true"/);
  assert.match(markup, new RegExp(`data-command="${name}\\.refresh"`));

  await transport.close();
  await host.close();
}

async function assertDuplicateExtensionIdsRejected() {
  const host = new DeterministicMockNovelHost();
  const transport = new MockElectronApiTransport({ host });
  const api = new DefaultNovelApiClient({ transport });
  const duplicateCommands = [
    { id: "duplicate", label: "One", execute: () => undefined },
    { id: "duplicate", label: "Two", execute: () => undefined },
  ];
  assert.throws(
    () =>
      renderToStaticMarkup(
        createElement(DesktopNovelApp, {
          api,
          platform: createPlatform("duplicate"),
          extensions: { commands: duplicateCommands },
        }),
      ),
    /command id must be unique/,
  );
  await transport.close();
  await host.close();
}

function createPlatform(name) {
  return Object.freeze({
    capabilities: Object.freeze({
      fileSelection: true,
      clipboardRead: true,
      clipboardWrite: true,
      notifications: name === "desktop",
    }),
    files: Object.freeze({
      selectFiles: async () => Object.freeze([]),
    }),
    clipboard: Object.freeze({
      readText: async () => "",
      writeText: async () => undefined,
    }),
    notifications: Object.freeze({
      show: async () => undefined,
    }),
  });
}
