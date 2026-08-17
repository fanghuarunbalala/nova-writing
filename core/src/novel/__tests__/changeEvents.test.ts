/**
 * deriveChangeEntities 测试：novel.changed 广播实体派生（级联删除补发）。
 */
import { describe, expect, it } from "vitest";
import { deriveChangeEntities } from "../changeEvents.js";

describe("deriveChangeEntities", () => {
  it("默认只返回结果实体", () => {
    expect(
      deriveChangeEntities(
        { op: "paragraph.insert", storyUnitId: "su1" as never, text: "正文" },
        { version: 1, changeId: "p1", entity: "paragraph" },
      ),
    ).toEqual(["paragraph"]);
  });

  it("storyUnit 级联删除波及段落时补发 paragraph（正文视图依赖其重拉）", () => {
    expect(
      deriveChangeEntities(
        {
          op: "outline.storyUnit.delete",
          storyUnitId: "su1" as never,
          baseRevision: 1,
          cascade: true,
        },
        {
          version: 1,
          changeId: "su1",
          entity: "outline",
          deleted: [{ kind: "paragraph", id: "p1", data: {} }],
        },
      ),
    ).toEqual(["outline", "paragraph"]);
  });

  it("storyUnit 删除未波及段落（无 cascade / 子树无段落）不补发", () => {
    expect(
      deriveChangeEntities(
        { op: "outline.storyUnit.delete", storyUnitId: "su1" as never, baseRevision: 1 },
        { version: 1, changeId: "su1", entity: "outline", deleted: [] },
      ),
    ).toEqual(["outline"]);
  });
});
