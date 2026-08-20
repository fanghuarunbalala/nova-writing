/**
 * WorkspaceController 新建项目入口（createAndOpen）行为：
 * 命名建目录成功 → 作为工作区打开；取消 → 静默回原状态；
 * 宿主未提供 / 建目录失败 → error 快照。
 */
import { describe, expect, it, vi } from "vitest";
import { WorkspaceController } from "../../../src/domains/workspace/controller/WorkspaceController.js";

function buildController(
  overrides: Partial<{
    createWorkspace: () => Promise<{ referenceId: string; label: string } | undefined>;
    open: () => Promise<{ id: string; label: string }>;
  }>,
) {
  const createWorkspace =
    overrides.createWorkspace ??
    (async () => ({ referenceId: "D:\\books\\新书", label: "新书" }));
  const open = overrides.open ?? (async () => ({ id: "ws-new", label: "新书" }));
  const controller = new WorkspaceController({
    picker: { pickWorkspace: async () => undefined, createWorkspace },
    sessions: {
      listRecent: async () => [],
      open,
      close: async () => undefined,
    },
  });
  return { controller, open };
}

describe("WorkspaceController.createAndOpen", () => {
  it("creates the folder and opens it as workspace", async () => {
    const createWorkspace = vi.fn(async () => ({
      referenceId: "D:\\books\\新书",
      label: "新书",
    }));
    const open = vi.fn(async () => ({ id: "ws-new", label: "新书" }));
    const { controller } = buildController({ createWorkspace, open });
    await controller.refresh();

    const session = await controller.createAndOpen();

    expect(createWorkspace).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ referenceId: "D:\\books\\新书", label: "新书" });
    expect(session).toEqual({ id: "ws-new", label: "新书" });
    expect(controller.getSnapshot().phase).toBe("ready");
    expect(controller.getSnapshot().current?.label).toBe("新书");
  });

  it("stays silent on cancel (returns to idle)", async () => {
    const { controller } = buildController({
      createWorkspace: async () => undefined,
    });
    await controller.refresh();

    const session = await controller.createAndOpen();

    expect(session).toBeUndefined();
    expect(controller.getSnapshot().phase).toBe("idle");
    expect(controller.getSnapshot().error).toBeUndefined();
  });

  it("reports error when directory creation fails", async () => {
    const { controller } = buildController({
      createWorkspace: async () => {
        throw new Error("无法在所选位置创建文件夹：D:\\只读");
      },
    });
    await controller.refresh();

    const session = await controller.createAndOpen();

    expect(session).toBeUndefined();
    expect(controller.getSnapshot().phase).toBe("error");
    expect(controller.getSnapshot().error?.message).toContain("无法在所选位置创建文件夹");
  });

  it("reports unavailable when host provides no createWorkspace port", async () => {
    const controller = new WorkspaceController({
      picker: { pickWorkspace: async () => undefined },
      sessions: {
        listRecent: async () => [],
        open: async () => ({ id: "x", label: "x" }),
        close: async () => undefined,
      },
    });
    await controller.refresh();

    await controller.createAndOpen();

    expect(controller.getSnapshot().phase).toBe("error");
    expect(controller.getSnapshot().error?.code).toBe("WORKSPACE_CREATE_UNAVAILABLE");
  });
});

describe("WorkspaceController 打开位置选择（当前窗口 / 新窗口）", () => {
  interface ReferenceView {
    readonly referenceId: string;
    readonly label: string;
  }

  function buildController(
    overrides: Partial<{
      open: (reference: ReferenceView) => Promise<{ id: string; label: string }>;
      openInNewWindow: (reference: ReferenceView) => Promise<void>;
      takeStartupWorkspace: () => Promise<ReferenceView | undefined>;
    }> = {},
  ) {
    const open =
      overrides.open ??
      (async (reference: ReferenceView) => ({ id: reference.referenceId, label: reference.label }));
    const sessions: Record<string, unknown> = {
      listRecent: async () => [],
      open,
      close: async () => undefined,
    };
    if (overrides.openInNewWindow !== undefined) {
      sessions.openInNewWindow = overrides.openInNewWindow;
    }
    if (overrides.takeStartupWorkspace !== undefined) {
      sessions.takeStartupWorkspace = overrides.takeStartupWorkspace;
    }
    const controller = new WorkspaceController({
      picker: {
        pickWorkspace: async () => ({ referenceId: "D:\\books\\第二本", label: "第二本" }),
      },
      sessions: sessions as never,
    });
    return { controller, open };
  }

  it("pickWorkspaceReference 仅选择不打开：返回引用、open 不被调、相位回落可交互", async () => {
    const open = vi.fn(async (reference: ReferenceView) => ({
      id: reference.referenceId,
      label: reference.label,
    }));
    const controller = new WorkspaceController({
      picker: {
        pickWorkspace: async () => ({ referenceId: "D:\\books\\第二本", label: "第二本" }),
      },
      sessions: { listRecent: async () => [], open, close: async () => undefined },
    });
    await controller.refresh();
    // 模拟已有项目打开（切换对话框只在 current 存在时出现）
    await controller.open({ referenceId: "ws-1", label: "在写" });
    expect(open).toHaveBeenCalledTimes(1);

    const reference = await controller.pickWorkspaceReference();

    expect(reference).toEqual({ referenceId: "D:\\books\\第二本", label: "第二本" });
    expect(open).toHaveBeenCalledTimes(1); // pick 未触发 open
    expect(controller.getSnapshot().phase).toBe("ready"); // 回落，打开位置面板可交互
  });

  it("open(reference) 当前窗口打开成功", async () => {
    const { controller } = buildController();
    await controller.refresh();

    const session = await controller.open({ referenceId: "D:\\books\\第二本", label: "第二本" });

    expect(session).toEqual({ id: "D:\\books\\第二本", label: "第二本" });
    expect(controller.getSnapshot().phase).toBe("ready");
    expect(controller.getSnapshot().current?.id).toBe("D:\\books\\第二本");
  });

  it("open 失败透传主进程错误文案（如双开提示），空文案回退通用提示", async () => {
    const withError = async (error: unknown): Promise<string | undefined> => {
      const { controller } = buildController({
        open: async () => {
          throw error;
        },
      });
      await controller.refresh();
      await controller.open({ referenceId: "ws-x", label: "x" });
      return controller.getSnapshot().error?.message;
    };
    expect(await withError(new Error("该项目已在另一窗口打开，已为你切换到该窗口"))).toBe(
      "该项目已在另一窗口打开，已为你切换到该窗口",
    );
    expect(await withError(new Error("  "))).toBe("Workspace 打开失败");
    expect(await withError("boom")).toBe("Workspace 打开失败");
  });

  it("openInNewWindow 派发成功：current 不动、无相位破坏", async () => {
    const openInNewWindow = vi.fn(async () => undefined);
    const { controller } = buildController({ openInNewWindow });
    await controller.refresh();
    await controller.open({ referenceId: "ws-1", label: "在写" });

    const dispatched = await controller.openInNewWindow({
      referenceId: "D:\\books\\第二本",
      label: "第二本",
    });

    expect(dispatched).toBe(true);
    expect(openInNewWindow).toHaveBeenCalledWith({
      referenceId: "D:\\books\\第二本",
      label: "第二本",
    });
    expect(controller.getSnapshot().current?.id).toBe("ws-1"); // 当前窗口保持不动
    expect(controller.getSnapshot().phase).toBe("ready");
  });

  it("openInNewWindow 端口缺省报不可用；失败透传底层文案", async () => {
    const { controller } = buildController();
    await controller.refresh();
    await controller.openInNewWindow({ referenceId: "ws-2", label: "第二本" });
    expect(controller.getSnapshot().error?.code).toBe("WORKSPACE_NEW_WINDOW_UNAVAILABLE");

    const failing = buildController({
      openInNewWindow: async () => {
        throw new Error("未授权的 workspace 引用: ws-9");
      },
    });
    await failing.controller.refresh();
    const dispatched = await failing.controller.openInNewWindow({
      referenceId: "ws-9",
      label: "x",
    });
    expect(dispatched).toBe(false);
    expect(failing.controller.getSnapshot().error?.message).toBe("未授权的 workspace 引用: ws-9");
  });

  it("openStartupWorkspace：有启动上下文则打开；取出即清（重复调用静默跳过）；无端口静默", async () => {
    let startup: ReferenceView | undefined = {
      referenceId: "D:\\books\\第二本",
      label: "第二本",
    };
    const { controller } = buildController({
      takeStartupWorkspace: async () => {
        const pending = startup;
        startup = undefined;
        return pending;
      },
    });
    await controller.refresh();

    await controller.openStartupWorkspace();
    expect(controller.getSnapshot().current?.id).toBe("D:\\books\\第二本");

    await controller.openStartupWorkspace(); // 第二次：上下文已清，静默跳过
    expect(controller.getSnapshot().phase).toBe("ready");

    const bare = buildController(); // 无 takeStartupWorkspace 端口
    await bare.controller.refresh();
    await bare.controller.openStartupWorkspace();
    expect(bare.controller.getSnapshot().phase).toBe("idle");
    expect(bare.controller.getSnapshot().error).toBeUndefined();
  });
});
