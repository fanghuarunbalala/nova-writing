/**
 * WorkspaceController（纯云端化 ⑥：本地 picker/recent 通道退役后的收缩表面）：
 * open（云项目引用）/ closeCurrent / openInNewWindow / openStartupWorkspace /
 * notifyOpened（主进程推送同步）/ clearError 的编排与错误快照。
 */
import { describe, expect, it, vi } from "vitest";
import { WorkspaceController } from "../../../src/domains/workspace/controller/WorkspaceController.js";

function buildController(
  overrides: Partial<{
    open: () => Promise<{ id: string; label: string }>;
    openInNewWindow: (reference: { referenceId: string; label: string }) => Promise<void>;
    takeStartupWorkspace: () => Promise<{ referenceId: string; label: string } | undefined>;
  }> = {},
) {
  const open = overrides.open ?? (async () => ({ id: "ws-1", label: "云端测试书" }));
  const sessions = {
    open,
    close: vi.fn(async () => undefined),
    ...(overrides.openInNewWindow !== undefined ? { openInNewWindow: overrides.openInNewWindow } : {}),
    ...(overrides.takeStartupWorkspace !== undefined ? { takeStartupWorkspace: overrides.takeStartupWorkspace } : {}),
  };
  const controller = new WorkspaceController({ sessions });
  return { controller, sessions };
}

describe("WorkspaceController.open（云项目引用）", () => {
  it("成功 → ready + current", async () => {
    const open = vi.fn(async () => ({ id: "ws-1", label: "云端测试书" }));
    const { controller } = buildController({ open });
    const session = await controller.open({ referenceId: "ws-1", label: "云端测试书" });
    expect(open).toHaveBeenCalledWith({ referenceId: "ws-1", label: "云端测试书" });
    expect(session).toEqual({ id: "ws-1", label: "云端测试书" });
    expect(controller.getSnapshot().phase).toBe("ready");
    expect(controller.getSnapshot().current?.label).toBe("云端测试书");
  });

  it("失败（如双开/在用拒绝）→ error 快照透传主进程文案", async () => {
    const { controller } = buildController({
      open: async () => {
        throw new Error("该项目已在另一窗口打开，已为你切换到该窗口");
      },
    });
    const session = await controller.open({ referenceId: "ws-1", label: "云端测试书" });
    expect(session).toBeUndefined();
    expect(controller.getSnapshot().phase).toBe("error");
    expect(controller.getSnapshot().error?.message).toContain("已在另一窗口打开");
    controller.clearError();
    expect(controller.getSnapshot().error).toBeUndefined();
  });
});

describe("WorkspaceController.closeCurrent", () => {
  it("打开后关闭 → idle（current 清空）", async () => {
    const { controller, sessions } = buildController();
    await controller.open({ referenceId: "ws-1", label: "云端测试书" });
    expect(await controller.closeCurrent()).toBe(true);
    expect(sessions.close).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().phase).toBe("idle");
    expect(controller.getSnapshot().current).toBeUndefined();
  });

  it("未打开时关闭 = 幂等成功（不调端口）", async () => {
    const { controller, sessions } = buildController();
    expect(await controller.closeCurrent()).toBe(true);
    expect(sessions.close).not.toHaveBeenCalled();
  });
});

describe("WorkspaceController.openInNewWindow", () => {
  it("派发成功 → true；端口缺失 → error + false", async () => {
    const dispatch = vi.fn(async () => undefined);
    const { controller } = buildController({ openInNewWindow: dispatch });
    expect(await controller.openInNewWindow({ referenceId: "ws-1", label: "云端测试书" })).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);

    const bare = new WorkspaceController({ sessions: { open: async () => ({ id: "x", label: "y" }), close: async () => undefined } });
    expect(await bare.openInNewWindow({ referenceId: "ws-1", label: "云端测试书" })).toBe(false);
    expect(bare.getSnapshot().error?.code).toBe("WORKSPACE_NEW_WINDOW_UNAVAILABLE");
  });
});

describe("WorkspaceController.openStartupWorkspace", () => {
  it("有启动上下文 → 自动打开；无上下文/端口缺失 → 静默", async () => {
    const { controller } = buildController({
      takeStartupWorkspace: async () => ({ referenceId: "ws-1", label: "云端测试书" }),
    });
    await controller.openStartupWorkspace();
    expect(controller.getSnapshot().phase).toBe("ready");
    expect(controller.getSnapshot().current?.label).toBe("云端测试书");

    const { controller: empty } = buildController({
      takeStartupWorkspace: async () => undefined,
    });
    await empty.openStartupWorkspace();
    expect(empty.getSnapshot().phase).toBe("idle");
  });
});

describe("WorkspaceController.notifyOpened", () => {
  it("主进程推送已打开会话 → 同步 current + ready（幂等）", async () => {
    const { controller } = buildController();
    controller.notifyOpened({ id: "ws-9", label: "他端打开的书" });
    expect(controller.getSnapshot().phase).toBe("ready");
    expect(controller.getSnapshot().current?.label).toBe("他端打开的书");
    const revision = controller.getSnapshot().revision;
    controller.notifyOpened({ id: "ws-9", label: "他端打开的书" });
    expect(controller.getSnapshot().revision).toBe(revision);
  });
});
