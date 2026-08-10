/**
 * ParameterView 单测：中文标签行、嵌套递归、数组连接、枚举翻译、长文展开。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParameterView } from "../../../../src/domains/approval/components/ParameterView.js";

describe("ParameterView", () => {
  it("renders top-level keys as Chinese-labelled rows", () => {
    render(<ParameterView value={{ name: "林夏", authorNotes: "作者注记内容" }} />);
    expect(screen.getByText("名称")).toBeInTheDocument();
    expect(screen.getByText("林夏")).toBeInTheDocument();
    expect(screen.getByText("作者注记")).toBeInTheDocument();
  });

  it("flattens object arrays without 变更项/第 N 项 wrappers", () => {
    render(
      <ParameterView
        value={{
          baseRevision: "rev-1",
          values: [
            { id: "C-1", name: "林夏", aliases: ["夏", "夏夏"] },
            { id: "C-2", name: "顾一舟" },
          ],
        }}
      />,
    );
    expect(screen.queryByText("变更项")).not.toBeInTheDocument();
    expect(screen.queryByText("第 1 项")).not.toBeInTheDocument();
    expect(screen.queryByText("第 2 项")).not.toBeInTheDocument();
    expect(screen.getAllByText("林夏").length).toBeGreaterThan(0);
    expect(screen.getAllByText("顾一舟").length).toBeGreaterThan(0);
  });

  it("joins primitive arrays with 、", () => {
    render(<ParameterView value={{ roles: ["point-of-view", "participant"] }} />);
    expect(screen.getByText("视角、参与者")).toBeInTheDocument();
  });

  it("renders primitive arrays like aliases inline with the label", () => {
    render(<ParameterView value={{ name: "林夏", aliases: ["夏", "夏夏"] }} />);
    const labelRow = screen.getByText("别名").parentElement;
    const valueNode = screen.getByText("夏、夏夏");
    // 别名应为行内标签：与连接后的值在同一行，而非独立子区块标题。
    expect(labelRow?.textContent).toContain("夏、夏夏");
    expect(valueNode.parentElement).toBe(labelRow);
  });

  it("renders empty primitive arrays as 空 inline", () => {
    render(<ParameterView value={{ aliases: [] }} />);
    const labelRow = screen.getByText("别名").parentElement;
    expect(labelRow?.textContent).toContain("空");
  });

  it("renders null as 空 and booleans as 是/否", () => {
    render(<ParameterView value={{ cascade: true, note: null }} />);
    expect(screen.getByText("是")).toBeInTheDocument();
    expect(screen.getByText("空")).toBeInTheDocument();
  });

  it("translates enum values", () => {
    render(<ParameterView value={{ planningStatus: "idea", scope: "scene" }} />);
    expect(screen.getByText("点子")).toBeInTheDocument();
    expect(screen.getByText("场景")).toBeInTheDocument();
  });

  it("shows expand toggle for long text and none for short", () => {
    const { rerender } = render(<ParameterView value={{ summary: "短" }} />);
    expect(screen.queryByText("展开全文")).not.toBeInTheDocument();
    rerender(<ParameterView value={{ summary: "长".repeat(200) }} />);
    expect(screen.getByText("展开全文")).toBeInTheDocument();
  });

  it("orders fields name first and authorNotes last", () => {
    const { container } = render(
      <ParameterView
        value={{ authorNotes: "尾注", summary: "中", name: "林夏", aliases: ["夏"] }}
      />,
    );
    const text = container.textContent ?? "";
    const order = ["名称", "别名", "简介", "作者注记"].map((label) =>
      text.indexOf(label),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("hides baseRevision", () => {
    render(<ParameterView value={{ baseRevision: "rev-1", name: "林夏" }} />);
    expect(screen.queryByText("rev-1")).not.toBeInTheDocument();
    expect(screen.queryByText("基础修订版本")).not.toBeInTheDocument();
  });

  it("renders diff gutter glyphs when tone is set", () => {
    render(<ParameterView value={{ name: "林夏", aliases: ["夏"] }} tone="add" />);
    expect(screen.getAllByText("+").length).toBeGreaterThan(0);
  });

  it("renders no gutter without tone", () => {
    render(<ParameterView value={{ name: "林夏" }} />);
    expect(screen.queryAllByText("+")).toHaveLength(0);
  });

  it("threads tone into nested object-array items", () => {
    render(
      <ParameterView
        value={{ values: [{ name: "林夏" }, { name: "顾一舟" }] }}
        tone="edit"
      />,
    );
    expect(screen.getAllByText("~").length).toBeGreaterThan(0);
  });
});
