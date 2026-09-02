/**
 * AssistantMessage 分段渲染测试（对齐 demo 定稿形态）。
 * - 段文本完整（拼接 === 全文，live/收口一致）：逐段交错渲染「正文片段 + 工具组」，
 *   收口后不丢早期正文片段与工具组
 * - 重放形态（段文本为空，拼接 ≠ 全文）：完整正文 + 各批工具组
 * 文案对齐 app-redesign demo：`工具原名 · 摘要`。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssistantMessage } from "../../../src/domains/conversation/components/AssistantMessage.js";

describe("AssistantMessage 定稿全文 + 工具组交错渲染", () => {
  it("段文本完整（收口后）：全部正文片段与工具组交错渲染，不丢早期段", () => {
    render(
      <AssistantMessage
        sequence={1}
        text="好的，我先创建角色——接着写正文——秋夜的风穿过旧船坞。"
        segments={[
          {
            text: "好的，我先创建角色——",
            tools: [
              {
                traceId: "t1",
                toolName: "CharacterWrite",
                outcome: "ok",
                durationMs: 1200,
                sequence: 1,
                preview: { action: "创建", object: "角色", title: "张三" },
              },
            ],
          },
          {
            text: "接着写正文——秋夜的风穿过旧船坞。",
            tools: [
              {
                traceId: "t2",
                toolName: "ParagraphWrite",
                outcome: "ok",
                durationMs: 3400,
                sequence: 2,
                preview: { action: "插入", object: "正文", title: "ch3" },
              },
            ],
          },
        ]}
      />,
    );
    // 收口后（streaming=false）不再收敛为最后一段：两段正文与两批工具行全部渲染
    expect(screen.getByText(/我先创建角色/)).toBeInTheDocument();
    expect(screen.getByText(/CharacterWrite · 张三/)).toBeInTheDocument();
    expect(screen.getByText(/接着写正文/)).toBeInTheDocument();
    expect(screen.getByText(/ParagraphWrite · ch3/)).toBeInTheDocument();
  });

  it("live 流式（streaming=true）：逐段交错渲染，每段内容 + 工具组换行分隔", () => {
    render(
      <AssistantMessage
        sequence={1}
        streaming
        text="好的，我先创建角色，接着写正文"
        segments={[
          {
            text: "好的，我先创建角色——",
            tools: [
              {
                traceId: "t1",
                toolName: "CharacterWrite",
                outcome: "ok",
                durationMs: 1200,
                sequence: 1,
                preview: { action: "创建", object: "角色", title: "张三" },
              },
            ],
          },
          {
            text: "接着写正文",
            tools: [
              {
                traceId: "t2",
                toolName: "ParagraphWrite",
                startedAt: Date.now(),
                sequence: 2,
                preview: { action: "插入", object: "正文", title: "ch3" },
              },
            ],
          },
        ]}
      />,
    );
    // 流式期间：每个段的内容与工具行都渲染（换行分隔，边界清晰，正文无跳变）
    expect(screen.getByText(/我先创建角色/)).toBeInTheDocument();
    expect(screen.getByText(/CharacterWrite · 张三/)).toBeInTheDocument();
    expect(screen.getByText(/接着写正文/)).toBeInTheDocument();
    expect(screen.getByText(/ParagraphWrite · ch3/)).toBeInTheDocument();
  });

  it("重放形态（段文本为空）：完整文本 + 各批工具行全量渲染", () => {
    render(
      <AssistantMessage
        sequence={1}
        text="好的，我先创建角色，接着写正文——秋夜的风穿过旧船坞。"
        segments={[
          { text: "", tools: [{ traceId: "t1", toolName: "CharacterWrite", outcome: "ok", durationMs: 1200, sequence: 1, preview: { action: "创建", object: "角色", title: "张三" } }] },
          { text: "", tools: [{ traceId: "t2", toolName: "ParagraphWrite", outcome: "ok", durationMs: 3400, sequence: 2, preview: { action: "插入", object: "正文", title: "ch3" } }] },
        ]}
      />,
    );
    expect(screen.getByText(/秋夜的风/)).toBeInTheDocument();
    // 重放不再只显示最后一批：两批工具行全量渲染
    expect(screen.getByText(/CharacterWrite · 张三/)).toBeInTheDocument();
    expect(screen.getByText(/ParagraphWrite · ch3/)).toBeInTheDocument();
    // 方案 A：完成态不显示耗时（durationMs 不再渲染）
  });

  it("无 segments：仅渲染完整文本，无工具行", () => {
    render(<AssistantMessage sequence={1} text="好的，我明白了。" />);
    expect(screen.getByText(/好的，我明白了。/)).toBeInTheDocument();
  });

  it("助手头部行：渐变头像 + 名称 + mono 时间 + 模式 chip；工具行包在 toolGroup 容器内", () => {
    const today1402 = new Date();
    today1402.setHours(14, 2, 0, 0);
    render(
      <AssistantMessage
        sequence={1}
        agentLabel="Novel 助理"
        timestamp={today1402.getTime()}
        mode="compose"
        text="好的，我先写正文。"
        segments={[
          {
            text: "好的，我先写正文。",
            tools: [
              {
                traceId: "t1",
                toolName: "ParagraphWrite",
                outcome: "ok",
                durationMs: 1200,
                sequence: 1,
                preview: { action: "插入", object: "正文", title: "ch3" },
              },
            ],
          },
        ]}
      />,
    );
    // 头部行：名称 / 时间（demo .mMeta 文案）/ 模式 chip（compose → 设计）
    expect(screen.getByText(/Novel 助理/)).toBeInTheDocument();
    expect(screen.getByText(/今天 14:02/)).toBeInTheDocument();
    expect(screen.getByText(/设计/)).toBeInTheDocument();
    // 工具行渲染（新文案 demo 式）且位于 toolGroup 容器内（.toolLine div → .toolGroup div
    // 两级包裹；jsdom 下 CSS module 类名不保留，按标签层级断言容器存在）
    const toolLine = screen.getByText(/ParagraphWrite · ch3/);
    expect(toolLine).toBeInTheDocument();
    expect(toolLine.parentElement?.tagName).toBe("DIV");
    expect(toolLine.parentElement?.parentElement?.tagName).toBe("DIV");
  });
});
