/**
 * paramLabels 单测：key / 枚举值 / 工具名中文映射与原文回退、字段排序/隐藏、op 推断。
 */
import { describe, expect, it } from "vitest";
import {
  inferOperation,
  isParamFieldHidden,
  operationGlyph,
  operationLabel,
  paramFieldRank,
  paramKeyLabel,
  paramValueLabel,
  toolNameLabel,
} from "../../../src/domains/approval/paramLabels.js";

describe("paramLabels", () => {
  it("translates known keys and falls back to raw key", () => {
    expect(paramKeyLabel("baseRevision")).toBe("基础修订版本");
    expect(paramKeyLabel("authorNotes")).toBe("作者注记");
    expect(paramKeyLabel("not-a-key")).toBeUndefined();
  });

  it("translates enum values per field and falls back to raw", () => {
    expect(paramValueLabel("planningStatus", "idea")).toBe("点子");
    expect(paramValueLabel("realizationStatus", "in-progress")).toBe("进行中");
    expect(paramValueLabel("rhythm", "climax")).toBe("高潮");
    expect(paramValueLabel("category", "relationship")).toBe("关系");
    expect(paramValueLabel("planningStatus", "unknown-value")).toBeUndefined();
    expect(paramValueLabel("unknown-field", "idea")).toBeUndefined();
  });

  it("translates tool names and falls back to raw", () => {
    expect(toolNameLabel("NovelCharacterWrite")).toBe("角色写入");
    expect(toolNameLabel("NovelDelete")).toBe("删除");
    expect(toolNameLabel("UnknownTool")).toBe("UnknownTool");
  });

  it("ranks fields with name first, aliases next, authorNotes last", () => {
    expect(paramFieldRank("name")).toBe(0);
    expect(paramFieldRank("aliases")).toBe(1);
    expect(paramFieldRank("authorNotes")).toBe(100);
    expect(paramFieldRank("summary")).toBe(50);
    expect(paramFieldRank("unknown-field")).toBe(50);
  });

  it("hides baseRevision and id but keeps other fields", () => {
    expect(isParamFieldHidden("baseRevision")).toBe(true);
    expect(isParamFieldHidden("id")).toBe(true);
    expect(isParamFieldHidden("name")).toBe(false);
    expect(isParamFieldHidden("characterId")).toBe(false);
  });

  it("infers operation from operations[0] and falls back to tool name", () => {
    expect(inferOperation("NovelCharacterWrite", [{ op: "add" }])).toBe("add");
    expect(inferOperation("NovelCharacterEdit", undefined)).toBe("edit");
    expect(inferOperation("NovelDelete", undefined)).toBe("delete");
    expect(inferOperation("EnterComposeMode", undefined)).toBeUndefined();
  });

  it("labels operations as 写入/编辑/删除", () => {
    expect(operationLabel("add")).toBe("写入");
    expect(operationLabel("edit")).toBe("编辑");
    expect(operationLabel("delete")).toBe("删除");
    expect(operationLabel("unknown")).toBeUndefined();
  });

  it("maps operations to diff glyphs", () => {
    expect(operationGlyph("add")).toBe("+");
    expect(operationGlyph("edit")).toBe("~");
    expect(operationGlyph("delete")).toBe("−");
    expect(operationGlyph("unknown")).toBeUndefined();
  });
});
