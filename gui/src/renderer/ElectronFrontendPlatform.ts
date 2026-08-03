/** Initial desktop platform port with every not-yet-bridged native capability disabled. */
import type { FrontendPlatform } from "@novel/ui";

export function createElectronFrontendPlatform(): FrontendPlatform {
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
