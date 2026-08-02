/** Compile-only proof that desktop and Web shells share one NovelApp contract. */
import type { NovelApiClient } from "@novel/core";
import type { FrontendPlatform, NovelUiExtensions } from "../src/index.js";
import { DesktopNovelApp } from "../../gui/src/renderer/index.js";
import { WebNovelApp } from "../../web/src/index.js";

declare const api: NovelApiClient;
declare const platform: FrontendPlatform;
declare const extensions: NovelUiExtensions;

const desktop = (
  <DesktopNovelApp api={api} platform={platform} extensions={extensions} />
);
const web = <WebNovelApp api={api} platform={platform} extensions={extensions} />;

// @ts-expect-error Every shell must inject a platform explicitly.
const missingPlatform = <WebNovelApp api={api} />;

void desktop;
void web;
void missingPlatform;
