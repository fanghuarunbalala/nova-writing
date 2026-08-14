/**
 * AssistantMessage turn 工具行渲染测试（一轮只显示最后一 turn）。
 * （RuntimeEventFlow「本轮时序」面板已移除；ToolStrip 已由单行工具替代；
 * 一轮只显示最后一个 turn 的内容 + 该次请求的工具行。）
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssistantMessage } from "../../../src/domains/conversation/components/AssistantMessage.js";

describe("AssistantMessage 一轮只显示最后一 turn", () => {
  it("正文 = 最后一段内容片段；工具行只取最后一段（最后一次请求）", () => {
    render(
      <AssistantMessage
        sequence={1}
        text="好的，我先创建角色，接着写正文——秋夜的风穿过旧船坞。"
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
            text: "接着写正文——",
            tools: [
              {
                traceId: "t2",
                toolName: "ParagraphWrite",
                startedAt: Date.now(),
                sequence: 2,
                preview: { action: "插入", object: "正文", title: "ch3" },
              },
              {
                traceId: "t3",
                toolName: "Glob",
                outcome: "failed",
                durationMs: 300,
                sequence: 3,
                preview: { action: "查找", object: "文件", title: "**/*.md" },
              },
            ],
          },
        ]}
      />,
    );
    // 正文 = 最后一段的内容片段（不是完整拼接，历史段内容不显示）
    expect(screen.getByText(/接着写正文/)).toBeInTheDocument();
    expect(screen.queryByText(/我先创建角色/)).not.toBeInTheDocument();
    expect(screen.queryByText(/秋夜的风/)).not.toBeInTheDocument();
    // 工具行只显示最后一段（最后一次请求的工具：正文插入中 + 文件查找失败）
    expect(screen.getByText(/插入正文中：ch3/)).toBeInTheDocument();
    expect(screen.getByText(/文件查找失败：\*\*\/\*\.md/)).toBeInTheDocument();
    // 历史段的工具行不显示
    expect(screen.queryByText(/角色创建已完成：张三/)).not.toBeInTheDocument();
  });

  it("live 流式（streaming=true）：逐 turn 分段渲染，每段内容 + 工具行换行分隔", () => {
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
    // 流式期间：每个 turn 的内容与工具行都渲染（换行分隔，边界清晰，正文无跳变）
    expect(screen.getByText(/我先创建角色/)).toBeInTheDocument();
    expect(screen.getByText(/角色创建已完成：张三/)).toBeInTheDocument();
    expect(screen.getByText(/接着写正文/)).toBeInTheDocument();
    expect(screen.getByText(/插入正文中：ch3/)).toBeInTheDocument();
  });

  it("重放形态：段文本为空 → 完整文本 + 最后一段工具行", () => {
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
    expect(screen.getByText(/正文插入已完成：ch3/)).toBeInTheDocument();
    expect(screen.getByText(/3\.4s/)).toBeInTheDocument();
    // 历史段（角色创建）不显示
    expect(screen.queryByText(/角色创建已完成：张三/)).not.toBeInTheDocument();
  });

  it("无 segments：仅渲染完整文本，无工具行", () => {
    render(<AssistantMessage sequence={1} text="好的，我明白了。" />);
    expect(screen.getByText(/好的，我明白了。/)).toBeInTheDocument();
  });
});
