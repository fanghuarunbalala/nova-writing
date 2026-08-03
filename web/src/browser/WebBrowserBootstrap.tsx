/** Composes and mounts the shared React application in a same-origin browser shell. */
import {
  ApiTransportError,
  DefaultNovelApiClient,
  noopLogger,
  type Logger,
  type NovelApiClient,
} from "@novel/core";
import type { FrontendPlatform } from "@novel/ui";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebNovelApp, type WebNovelAppProps } from "../WebNovelApp.js";
import {
  HttpWebSocketApiTransport,
  type HttpWebSocketApiTransportOptions,
} from "../transport/index.js";
import { createBrowserFrontendPlatform } from "./BrowserFrontendPlatform.js";

export interface WebBrowserLocationPort {
  readonly origin: string;
}

export interface WebBrowserWindowPort {
  readonly location: WebBrowserLocationPort;
}

export interface WebBrowserCompositionOptions {
  readonly window: WebBrowserWindowPort;
  readonly platform?: FrontendPlatform;
  readonly transport?: Omit<HttpWebSocketApiTransportOptions, "origin" | "logger">;
  readonly logger?: Logger;
}

export interface WebBrowserComposition {
  readonly origin: string;
  readonly transport: HttpWebSocketApiTransport;
  readonly api: NovelApiClient;
  readonly platform: FrontendPlatform;
}

export interface MountWebBrowserOptions extends WebBrowserCompositionOptions {
  readonly document: Pick<Document, "getElementById">;
  readonly rootElementId?: string;
  readonly appProps?: Omit<WebNovelAppProps, "api" | "platform" | "logger">;
}

export interface MountedWebBrowser extends WebBrowserComposition {
  readonly root: Root;
  close(): Promise<void>;
}

export function createWebBrowserComposition(
  options: WebBrowserCompositionOptions,
): WebBrowserComposition {
  const logger = (options.logger ?? noopLogger).child({
    component: "web_browser_bootstrap",
  });
  const origin = resolveWebApiOrigin(options.window.location);
  const transport = new HttpWebSocketApiTransport({
    ...options.transport,
    origin,
    logger,
  });
  return Object.freeze({
    origin,
    transport,
    api: new DefaultNovelApiClient({ transport, logger }),
    platform: options.platform ?? createBrowserFrontendPlatform(),
  });
}

export function mountWebBrowser(
  options: MountWebBrowserOptions,
): MountedWebBrowser {
  const logger = (options.logger ?? noopLogger).child({
    component: "web_browser_mount",
  });
  const composition = createWebBrowserComposition({
    window: options.window,
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
    logger,
  });
  const rootElementId = options.rootElementId ?? "root";
  const rootElement = options.document.getElementById(rootElementId);
  if (rootElement === null) {
    void composition.transport.close();
    throw new ApiTransportError(
      "WEB_BROWSER_ROOT_MISSING",
      false,
      "Web browser root element is unavailable",
    );
  }
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <WebNovelApp
        {...options.appProps}
        api={composition.api}
        platform={composition.platform}
        logger={logger}
      />
    </StrictMode>,
  );
  logger.info("web_browser.mounted");
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    ...composition,
    root,
    close: () => {
      closePromise ??= Promise.resolve().then(async () => {
        root.unmount();
        await composition.transport.close();
        logger.info("web_browser.closed");
      });
      return closePromise;
    },
  });
}

export function resolveWebApiOrigin(location: WebBrowserLocationPort): string {
  let origin: URL;
  try {
    origin = new URL(location.origin);
  } catch {
    throw invalidBrowserOrigin();
  }
  if (
    (origin.protocol !== "http:" && origin.protocol !== "https:") ||
    origin.origin !== location.origin ||
    origin.pathname !== "/" ||
    origin.search.length > 0 ||
    origin.hash.length > 0
  ) {
    throw invalidBrowserOrigin();
  }
  return origin.origin;
}

function invalidBrowserOrigin(): ApiTransportError {
  return new ApiTransportError(
    "WEB_BROWSER_ORIGIN_INVALID",
    false,
    "Web browser origin is unavailable",
  );
}
