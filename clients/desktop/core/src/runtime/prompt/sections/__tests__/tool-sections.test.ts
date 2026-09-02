import { describe, it, expect } from "vitest";
import { toolPolicySection, toolGuidanceSection } from "../agent.js";
import type { ReadonlyLoopContext } from "../../../loop/LoopContext.js";
import type { ToolDef } from "../../../tool/ToolDef.js";

/** 构造带 promptDetail 的最小 ToolDef 测试桩 */
function def(name: string, promptDetail?: ToolDef["promptDetail"]): ToolDef {
  return {
    name,
    version: "1.0.0",
    description: "",
    parameters: { type: "object", properties: {} },
    handler: { execute: async () => "" },
    promptDetail,
  };
}

/** 只提供 toolSchemes 的 ctx 桩（段只消费 toolSchemes） */
function ctxOf(tools: ToolDef[]): ReadonlyLoopContext {
  return { toolSchemes: tools } as unknown as ReadonlyLoopContext;
}

describe("tool.policy 动态段", () => {
  it("无工具 → 兜底文案", () => {
    expect(toolPolicySection.renderDynamic({}, ctxOf([]))).toContain(
      "No Tools are available",
    );
  });

  it("有工具但全无 policy → 仅 # Using Tools + 名单行", () => {
    const text = toolPolicySection.renderDynamic(
      {},
      ctxOf([def("Read"), def("Write")]),
    );
    expect(text).toBe("# Using Tools\n- available tools: Read, Write;");
  });

  it("policy 非空才输出，trim 后原样一行（无工具名前缀包装）", () => {
    const text = toolPolicySection.renderDynamic(
      {},
      ctxOf([
        def("Read", { policy: "  优先 Read 读文件，不要用 Bash cat 代替  " }),
        def("Write", { policy: "  " }),
        def("Edit"),
      ]),
    );
    expect(text).toBe(
      "# Using Tools\n- available tools: Read, Write, Edit;\n优先 Read 读文件，不要用 Bash cat 代替",
    );
  });
});

describe("tool.guidance 动态段", () => {
  it("无工具 / 全空 guidance → 整段省略（空串）", () => {
    expect(toolGuidanceSection.renderDynamic({}, ctxOf([]))).toBe("");
    expect(toolGuidanceSection.renderDynamic({}, ctxOf([def("Read"), def("Write")]))).toBe("");
    expect(
      toolGuidanceSection.renderDynamic({}, ctxOf([def("Read", { guidance: "  " })])),
    ).toBe("");
  });

  it("非空 guidance 原样输出一整段（标题内容由文本自定），多段空行分隔", () => {
    const text = toolGuidanceSection.renderDynamic(
      {},
      ctxOf([
        def("Read", { guidance: "# Read Guidance\n优先用 Read 读文件" }),
        def("Bash", { guidance: "# Bash Guidance\n超时默认 120s" }),
        def("Edit"),
      ]),
    );
    expect(text).toBe(
      "# Read Guidance\n优先用 Read 读文件\n\n# Bash Guidance\n超时默认 120s",
    );
  });
});
