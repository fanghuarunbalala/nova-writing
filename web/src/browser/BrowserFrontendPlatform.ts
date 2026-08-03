/** Browser-safe platform port with optional native capabilities disabled by default. */
import type { FrontendPlatform } from "@novel/ui";

export function createBrowserFrontendPlatform(): FrontendPlatform {
  return Object.freeze({
    capabilities: Object.freeze({
      fileSelection: false,
      clipboardRead: false,
      clipboardWrite: false,
      notifications: false,
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
