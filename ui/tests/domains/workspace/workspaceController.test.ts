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
