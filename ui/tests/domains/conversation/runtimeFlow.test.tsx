/**
 * AssistantMessage turn 分段工具行渲染测试。
 * （RuntimeEventFlow「本轮时序」面板已移除；ToolStrip 已由分段工具行替代，
 * 见 docs/design/tool-call-embed-demo.html。）
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssistantMessage } from "../../../src/domains/conversation/components/AssistantMessage.js";

describe("AssistantMessage turn 分段工具行", () => {
  it("分段渲染：内容片段 + 单行工具（进行中/完成/失败动作标识命名）", () => {
    render(
      <AssistantMessage
        sequence={1}
        text="好的，接着写正文"
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
    // 段内容渲染
    expect(screen.getByText(/好的，我先创建角色/)).toBeInTheDocument();
    expect(screen.getByText(/接着写正文/)).toBeInTheDocument();
    // 工具行命名：完成 / 进行中 / 失败
    expect(screen.getByText(/角色创建已完成：张三/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2s/)).toBeInTheDocument();
    expect(screen.getByText(/插入正文中：ch3/)).toBeInTheDocument();
    expect(screen.getByText(/文件查找失败：\*\*\/\*\.md/)).toBeInTheDocument();
    expect(screen.getByText(/0\.3s/)).toBeInTheDocument();
  });

  it("重放形态：段无文本 → 完整文本 + 各请求工具行", () => {
    render(
      <AssistantMessage
        sequence={1}
        text="好的，我先创建角色，接着写正文——秋夜的风穿过旧船坞。"
        segments={[
          {
            text: "",
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
            text: "",
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
    expect(screen.getByText(/秋夜的风/)).toBeInTheDocument();
    expect(screen.getByText(/角色创建已完成：张三/)).toBeInTheDocument();
    expect(screen.getByText(/正文插入已完成：ch3/)).toBeInTheDocument();
    expect(screen.getByText(/3\.4s/)).toBeInTheDocument();
  });

  it("无 segments：仅渲染完整文本，无工具行", () => {
    render(<AssistantMessage sequence={1} text="好的，我明白了。" />);
    expect(screen.getByText(/好的，我明白了。/)).toBeInTheDocument();
  });
});
