/**
 * 新创作中转页测试（demo 决议：首条消息才建会话）：
 * ChatStaging 组件（受控草稿 / 示例填入 / 模式选择 / 提交与取消）+
 * ChatSurface staging 分支集成（提交 → createConversation → 退出中转切消息流）。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ChatStaging } from "../../../src/domains/conversation/components/ChatStaging.js";
import type { ChatStagingDraft } from "../../../src/domains/conversation/components/ChatStaging.js";
import { ChatSurface } from "../../../src/shell/main/ChatSurface.js";
import { ConversationCatalogStore } from "../../../src/domains/conversation/store/ConversationCatalogStore.js";

/** 受控草稿 Harness：onDraftChange 落回 state，模拟壳层持有草稿 */
function createStagingHarness(overrides: Partial<Parameters<typeof ChatStaging>[0]> = {}) {
  const handlers = {
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  function Harness() {
    const [draft, setDraft] = useState<ChatStagingDraft>({ text: "", mode: "review" });
    return <ChatStaging draft={draft} onDraftChange={setDraft} {...handlers} />;
  }
  return { Harness, handlers };
}

describe("ChatStaging", () => {
  it("渲染介绍 / 上下文卡 / 示例 chips / 用法说明 / 底注", () => {
    const { Harness } = createStagingHarness({ workspaceLabel: "北河旧事" });
    render(<Harness />);
    expect(screen.getByText("开始一段新的创作")).toBeInTheDocument();
    expect(screen.getByText("《北河旧事》")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /角色档案|两个版本|梳理当前大纲|前后矛盾/ }).length,
    ).toBe(4);
    expect(screen.getByText("三种执行模式")).toBeInTheDocument();
    expect(screen.getByText("先审后落库")).toBeInTheDocument();
    expect(screen.getByText(/会话在发送首条消息后才会创建/)).toBeInTheDocument();
  });

  it("examples 覆盖：渲染项目实况示例（真实角色名/章标题）", () => {
    const { Harness } = createStagingHarness({
      examples: ["为沈砚完善角色档案", "把「第二章 旧船坞夜话」改写出两个版本"],
    });
    render(<Harness />);
    expect(screen.getByRole("button", { name: "为沈砚完善角色档案" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "把「第二章 旧船坞夜话」改写出两个版本" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "为主角补充角色档案" })).not.toBeInTheDocument();
  });

  it("workspaceLabel 缺省时隐藏上下文卡", () => {
    const { Harness } = createStagingHarness();
    render(<Harness />);
    expect(screen.queryByText("当前工作区 · 新会话将在此书稿上工作")).not.toBeInTheDocument();
  });

  it("示例 chip 点击填入输入框（不代发）", async () => {
    const user = userEvent.setup();
    const { Harness, handlers } = createStagingHarness();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "为主角补充角色档案" }));
    expect(screen.getByRole("textbox", { name: "新创作指令" })).toHaveValue("为主角补充角色档案");
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it("输入 + 发送 → onSubmit 携带 trim 文本与当前模式；空文本禁发", async () => {
    const user = userEvent.setup();
    const { Harness, handlers } = createStagingHarness();
    render(<Harness />);
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "新创作指令" }), "  起草第一卷的开场场景  ");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(handlers.onSubmit).toHaveBeenCalledWith({ text: "起草第一卷的开场场景", mode: "review" });
  });

  it("模式栏切换后随载荷提交", async () => {
    const user = userEvent.setup();
    const { Harness, handlers } = createStagingHarness();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "执行模式：需审核" }));
    await user.click(screen.getByRole("menuitem", { name: /设计/ }));
    await user.type(screen.getByRole("textbox", { name: "新创作指令" }), "出一份二卷设计草稿");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(handlers.onSubmit).toHaveBeenCalledWith({ text: "出一份二卷设计草稿", mode: "compose" });
  });

  it("Enter 提交、Shift+Enter 换行不提交", async () => {
    const user = userEvent.setup();
    const { Harness, handlers } = createStagingHarness();
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "新创作指令" });
    await user.type(input, "第一行");
    await user.type(input, "{Shift>}{Enter}{/Shift}");
    expect(handlers.onSubmit).not.toHaveBeenCalled();
    await user.type(input, "{Enter}");
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("返回 → onCancel；submitting 期间输入与发送禁用", async () => {
    const user = userEvent.setup();
    const { Harness, handlers } = createStagingHarness();
    const view = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    view.unmount();

    render(
      <ChatStaging
        draft={{ text: "已写的草稿", mode: "review" }}
        onDraftChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting
      />,
    );
    expect(screen.getByRole("textbox", { name: "新创作指令" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.getByText("正在创建会话…")).toBeInTheDocument();
  });
});

/** 构造带假 api 的目录 store（真实 store + 假 api，不 mock 模块） */
function createCatalogStore(create: () => Promise<unknown>): ConversationCatalogStore {
  const api = {
    conversations: {
      list: vi.fn(async () => []),
      create: vi.fn(create),
      open: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn(),
    },
  } as never;
  return new ConversationCatalogStore({ api });
}

/** 集成 Harness：模拟壳层——持有 staging 开关与草稿 state，onStagingExit 即置 false */
function ChatSurfaceHarness({
  store,
  onStagingExit,
  onNotify,
}: {
  store: ConversationCatalogStore;
  onStagingExit: () => void;
  onNotify: (kind: string, text: string) => void;
}) {
  const [staging, setStaging] = useState(true);
  const [draft, setDraft] = useState<ChatStagingDraft>({ text: "", mode: "review" });
  return (
    <ChatSurface
      conversationBinding={undefined}
      conversationCatalog={store}
      onCreateConversation={vi.fn()}
      staging={staging}
      stagingDraft={draft}
      onStagingDraftChange={setDraft}
      onStagingExit={() => {
        setStaging(false);
        onStagingExit();
      }}
      onNotify={onNotify}
      workspaceLabel="北河旧事"
    />
  );
}

describe("ChatSurface · 中转页分支", () => {
  it("staging 优先于消息流与空态：渲染中转页而非对话输入", async () => {
    const store = createCatalogStore(() => Promise.resolve({ conversationId: "c_new" }));
    await store.loadWorkspace("ws1");
    render(
      <ChatSurfaceHarness store={store} onStagingExit={vi.fn()} onNotify={vi.fn()} />,
    );
    expect(screen.getByRole("textbox", { name: "新创作指令" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "对话输入" })).not.toBeInTheDocument();
  });

  it("提交首条消息 → 此刻才 createConversation 并退出中转切消息流", async () => {
    const user = userEvent.setup();
    const create = vi.fn(async () => ({ conversationId: "c_new" }));
    const store = createCatalogStore(create);
    const onStagingExit = vi.fn();
    const onNotify = vi.fn();
    await store.loadWorkspace("ws1");
    render(<ChatSurfaceHarness store={store} onStagingExit={onStagingExit} onNotify={onNotify} />);
    expect(create).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: "新创作指令" }), "起草第一卷的开场场景");
    await user.click(screen.getByRole("button", { name: "发送" }));

    // 会话在首条消息提交时创建（此前不拉起子进程）；成功后退出中转 → 消息流 composer 出现
    expect(create).toHaveBeenCalledTimes(1);
    expect(onStagingExit).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("textbox", { name: "对话输入" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "新创作指令" })).not.toBeInTheDocument();
  });

  it("创建失败（返回空 id）→ 报错提示，留在中转页", async () => {
    const user = userEvent.setup();
    const store = createCatalogStore(() => Promise.reject(new Error("spawn failed")));
    const onStagingExit = vi.fn();
    const onNotify = vi.fn();
    await store.loadWorkspace("ws1");
    render(<ChatSurfaceHarness store={store} onStagingExit={onStagingExit} onNotify={onNotify} />);
    await user.type(screen.getByRole("textbox", { name: "新创作指令" }), "再试一次");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(onNotify).toHaveBeenCalledWith("danger", "会话创建失败，请重试");
    expect(onStagingExit).not.toHaveBeenCalled();
    // 草稿仍在：中转页还挂着（受控草稿未清）
    expect(screen.getByRole("textbox", { name: "新创作指令" })).toBeInTheDocument();
  });
});
