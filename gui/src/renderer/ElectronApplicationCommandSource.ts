/** Adapts fixed Main-menu commands into the shared application command source. */
import type {
  ApplicationCommand,
  ApplicationCommandSource,
} from "@novel/ui";
import type {
  ElectronApplicationCommand,
  ElectronPreloadBridge,
} from "../shared/index.js";

export function createElectronApplicationCommandSource(
  bridge: ElectronPreloadBridge,
): ApplicationCommandSource | undefined {
  const commands = bridge.commands;
  if (commands === undefined) return undefined;
  return Object.freeze({
    subscribe: (listener: (command: ApplicationCommand) => void) =>
      commands.subscribe((command) => listener(captureCommand(command))),
  });
}

function captureCommand(command: ElectronApplicationCommand): ApplicationCommand {
  return command;
}
