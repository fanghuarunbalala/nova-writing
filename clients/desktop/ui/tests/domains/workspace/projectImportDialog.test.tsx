/**
 * ProjectImportDialog 测试：预览完成后弹窗可关闭（busy 解锁回归）。
 *
 * 回归背景：handlePick 预览成功路径漏 setPreviewing(false)，previewing 泄漏使
 * busy = previewing || creating 恒 true——取消按钮/X/ESC/遮罩全部永久锁死
 * （"文件框取消后弹窗关不掉"的真实根因，与 RPC/对话框无关）。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImportPreview, NovelApiClient } from "@novel/core";
import { ProjectImportDialog } from "../../../src/domains/workspace/components/import/ProjectImportDialog.js";

// withCallOptions 要求 kkrpc remote proxy（普通 mock 对象会抛 TypeError）——测试里直传
vi.mock("kkrpc", () => ({
  withCallOptions: (api: unknown) => api,
}));

/** Radix Dialog 在 jsdom 下锁 body pointer-events——userEvent 命中检测会拦截，用 fireEvent */
const click = (el: Element): boolean => fireEvent.click(el);

const PREVIEW: ImportPreview = {
  sourceName: "旧稿.txt",
  kind: "txt",
  totalChars: 120,
  volumes: [{ key: "v1", title: "第一卷 风起" }],
  chapters: [
    { key: "c1", title: "第一章 启程", chars: 60, volumeKey: "v1" },
    { key: "c2", title: "第二章 转折", chars: 60, volumeKey: null },
  ],
  skippedFiles: [],
};

function buildApi(overrides?: Partial<Record<"pickImportFile" | "previewImport" | "createProjectFromImport", unknown>>) {
  return {
    projectImport: {
      pickImportFile: vi.fn(async () => ({ sourcePath: "D:/books/旧稿.txt" })),
      previewImport: vi.fn(async () => PREVIEW),
      createProjectFromImport: vi.fn(async () => ({ canceled: true })),
      createProgress: vi.fn(async () => null),
      importProgress: vi.fn(),
      ...overrides,
    },
  } as unknown as NovelApiClient;
}

async function renderWithPreview(api: NovelApiClient) {
  const onDismiss = vi.fn();
  render(
    <ProjectImportDialog
      open={true}
      api={api}
      onDismiss={onDismiss}
      onNotify={() => {}}
      onImported={() => {}}
    />,
  );
  // footer 主按钮与输入框旁按钮同名「选择文件」——取先渲染的 footer 主按钮
  click(screen.getAllByRole("button", { name: /选择文件/ })[0]!);
  // 预览落地（章标题以 Input value 形式出现 = handlePick 成功路径执行完毕）
  await waitFor(() => expect(screen.getByDisplayValue("第一章 启程")).toBeInTheDocument());
  return { onDismiss };
}

describe("ProjectImportDialog（busy 解锁回归）", () => {
  it("预览完成后取消按钮可点（previewing 复位）且能关闭弹窗", async () => {
    const { onDismiss } = await renderWithPreview(buildApi());
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(cancel).not.toBeDisabled();
    click(cancel);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("选位置取消（canceled:true）后弹窗解锁可关闭", async () => {
    const api = buildApi();
    const { onDismiss } = await renderWithPreview(api);
    // 模拟：选择位置并导入 → save 对话框取消 → RPC 返回 canceled
    click(screen.getByRole("button", { name: /选择位置并导入/ }));
    await waitFor(() => expect(api.projectImport.createProjectFromImport).toHaveBeenCalled());
    const cancel = screen.getByRole("button", { name: "取消" });
    await waitFor(() => expect(cancel).not.toBeDisabled());
    click(cancel);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("解析中（preview 挂起）取消按钮保持禁用（锁定语义不受影响）", async () => {
    const api = buildApi({
      previewImport: () => new Promise<ImportPreview>(() => {}),
    });
    render(
      <ProjectImportDialog
        open={true}
        api={api}
        onDismiss={() => {}}
        onNotify={() => {}}
        onImported={() => {}}
      />,
    );
    click(screen.getAllByRole("button", { name: /选择文件/ })[0]!);
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeDisabled());
  });
});
