/** Composes and mounts the shared React application inside Electron Renderer. */
import {
  DefaultNovelApiClient,
  ApiTransportError,
  noopLogger,
  type Logger,
  type NovelApiClient,
} from "@novel/core";
import type { ApplicationCommandSource, FrontendPlatform } from "@novel/ui";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DesktopNovelApp,
  type DesktopNovelAppProps,
} from "./DesktopNovelApp.js";
import { createElectronFrontendPlatform } from "./ElectronFrontendPlatform.js";
import { createElectronApplicationCommandSource } from "./ElectronApplicationCommandSource.js";
import { createElectronWorkspaceController } from "./ElectronWorkspaceController.js";
import {
  resolveElectronPreloadBridge,
  type DesktopRendererWindowPort,
} from "./ElectronPreloadBridgeResolver.js";
import { ElectronApiTransport } from "./transport/index.js";

export interface DesktopRendererCompositionOptions {
  readonly window: DesktopRendererWindowPort;
  readonly platform?: FrontendPlatform;
  readonly logger?: Logger;
}

export interface DesktopRendererComposition {
  readonly transport: ElectronApiTransport;
  readonly api: NovelApiClient;
  readonly platform: FrontendPlatform;
  readonly commandSource?: ApplicationCommandSource;
  readonly workspaceController?: NonNullable<DesktopNovelAppProps["workspaceController"]>;
}

export interface MountDesktopRendererOptions
  extends DesktopRendererCompositionOptions {
  readonly document: Pick<Document, "getElementById">;
  readonly rootElementId?: string;
  readonly appProps?: Omit<
    DesktopNovelAppProps,
    "api" | "platform" | "logger"
  >;
}

export interface MountedDesktopRenderer extends DesktopRendererComposition {
  readonly root: Root;
  close(): Promise<void>;
}

export function createDesktopRendererComposition(
  options: DesktopRendererCompositionOptions,
): DesktopRendererComposition {
  const logger = (options.logger ?? noopLogger).child({
    component: "desktop_renderer_bootstrap",
  });
  const bridge = resolveElectronPreloadBridge(options.window);
  const transport = new ElectronApiTransport({
    bridge,
    logger,
  });
  const workspaceController = createElectronWorkspaceController(bridge, logger);
  const commandSource = createElectronApplicationCommandSource(bridge);
  return Object.freeze({
    transport,
    api: new DefaultNovelApiClient({ transport, logger }),
    platform: options.platform ?? createElectronFrontendPlatform(),
    ...(commandSource !== undefined ? { commandSource } : {}),
    ...(workspaceController !== undefined ? { workspaceController } : {}),
  });
}

export function mountDesktopRenderer(
  options: MountDesktopRendererOptions,
): MountedDesktopRenderer {
  const logger = (options.logger ?? noopLogger).child({
    component: "desktop_renderer_mount",
  });
  const composition = createDesktopRendererComposition({
    window: options.window,
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    logger,
  });
  const rootElementId = options.rootElementId ?? "root";
  const rootElement = options.document.getElementById(rootElementId);
  if (rootElement === null) {
    void composition.transport.close();
    throw new ApiTransportError(
      "ELECTRON_RENDERER_ROOT_MISSING",
      false,
      "Electron Renderer root element is unavailable",
    );
  }
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <DesktopNovelApp
        {...options.appProps}
        api={composition.api}
        platform={composition.platform}
        logger={logger}
        commandSource={options.appProps?.commandSource ?? composition.commandSource}
        workspaceController={
          options.appProps?.workspaceController ?? composition.workspaceController
        }
      />
    </StrictMode>,
  );
  logger.info("desktop_renderer.mounted");
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    ...composition,
    root,
    close: () => {
      closePromise ??= Promise.resolve().then(async () => {
        root.unmount();
        await composition.transport.close();
        logger.info("desktop_renderer.closed");
      });
      return closePromise;
    },
  });
}
