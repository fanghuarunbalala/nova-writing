/**
 * paramLabels 单测：key / 枚举值 / 工具名中文映射与原文回退。
 */
import { describe, expect, it } from "vitest";
import {
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
});
