/** Builds the native Electron application menu from fixed safe commands. */
import type { MenuItemConstructorOptions } from "electron";
import type { ElectronApplicationCommand } from "../shared/index.js";

export interface DesktopApplicationMenuOptions {
  readonly applicationName: string;
  readonly platform: string;
  readonly dispatch: (command: ElectronApplicationCommand) => void;
}

export function createDesktopApplicationMenuTemplate(
  options: DesktopApplicationMenuOptions,
): readonly MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "项目",
      submenu: [
        {
          label: "打开 Workspace…",
          accelerator: "CmdOrCtrl+O",
          click: () => options.dispatch("workspace.open"),
        },
        {
          label: "关闭 Workspace",
          accelerator: "CmdOrCtrl+Shift+W",
          click: () => options.dispatch("workspace.close"),
        },
        ...(options.platform === "darwin"
          ? []
          : [
              { type: "separator" as const },
              { role: "quit" as const, label: "退出" },
            ]),
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
        { type: "separator" },
        {
          label: "设置…",
          accelerator: "CmdOrCtrl+,",
          click: () => options.dispatch("settings.open"),
        },
      ],
    },
    {
      label: "发布",
      submenu: [{ label: "发布设置…", enabled: false }],
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
