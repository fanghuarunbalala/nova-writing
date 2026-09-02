/** Fixed application commands emitted by platform shells such as Electron menus. */
export type ApplicationCommand =
  | "workspace.open"
  | "workspace.close"
  | "settings.open";

export type ApplicationCommandListener = (command: ApplicationCommand) => void;

export interface ApplicationCommandSource {
  subscribe(listener: ApplicationCommandListener): () => void;
}
