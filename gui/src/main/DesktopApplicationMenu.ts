/**
 * Builds the native Electron application menu from fixed safe commands.
 *
 * V0.2 精简菜单：项目（打开项目… / 新建项目…）、设置…、帮助。
 * 「打开项目…」在聚焦窗口内打开项目选择弹窗；「新建项目…」由 main
 * 进程直接新开一个窗口（新窗口显示项目选择页）。
 */
import type { MenuItemConstructorOptions } from "electron";
import type { ElectronApplicationCommand } from "../shared/index.js";

export interface DesktopApplicationMenuOptions {
  readonly applicationName: string;
  readonly platform: string;
  readonly dispatch: (command: ElectronApplicationCommand) => void;
  readonly openNewWindow: () => void;
}

export function createDesktopApplicationMenuTemplate(
  options: DesktopApplicationMenuOptions,
): readonly MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "项目",
      submenu: [
        {
          label: "打开项目…",
          accelerator: "CmdOrCtrl+O",
          click: () => options.dispatch("workspace.open"),
        },
        {
          label: "新建项目…",
          accelerator: "CmdOrCtrl+N",
          click: () => options.openNewWindow(),
        },
      ],
    },
    {
      label: "设置",
      submenu: [
        {
          label: "设置…",
          accelerator: "CmdOrCtrl+,",
          click: () => options.dispatch("settings.open"),
        },
      ],
    },
    {
      label: "帮助",
      submenu: [{ label: "Novel 帮助", enabled: false }],
    },
  ];
  if (options.platform === "darwin") {
    template.unshift({
      label: options.applicationName,
      submenu: [
        { role: "about", label: `关于 ${options.applicationName}` },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: `隐藏 ${options.applicationName}` },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: `退出 ${options.applicationName}` },
      ],
    });
  }
  return Object.freeze(template);
}
