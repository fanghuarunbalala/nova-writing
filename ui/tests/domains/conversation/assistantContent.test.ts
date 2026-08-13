/**
 * extractReferenceTags 单元测试。
 * Unit tests for the assistant reference-tag extractor.
 */
import { describe, expect, it } from "vitest";
import { extractReferenceTags } from "../../../src/domains/conversation/components/assistantContent/extractReferenceTags.js";

describe("extractReferenceTags", () => {
  it("闭合的引用标签替换为 cc:// 链接 token", () => {
    const out = extractReferenceTags(
      "他看向<character id=\"ch-3\">阿七</character>。",
    );
    expect(out).toContain("[ref](cc://character/ch-3/");
    expect(out).toContain(encodeURIComponent("阿七"));
    expect(out).not.toContain("<character");
  });

  it("chapter 引用与 name 覆盖替换为 token", () => {
    const out = extractReferenceTags(
      "详见<chapter id=\"chapter-301\">第一章</chapter>，别名<chapter id=\"chapter-301\" name=\"旧船坞\">第一章</chapter>。",
    );
    expect(out).toContain("[ref](cc://chapter/chapter-301/");
    expect(out).toContain(encodeURIComponent("第一章"));
    expect(out).toContain(encodeURIComponent("旧船坞"));
    expect(out).not.toContain("<chapter");
  });

  it("自闭合引用无 name 时生成空 label token", () => {
    const out = extractReferenceTags("地点<location id=\"loc-7\"/> 见");
    expect(out).toContain("[ref](cc://location/loc-7/)");
    expect(out).not.toContain("<location");
  });

  it("自闭合引用带 name 时使用 name 作为 label", () => {
    const out = extractReferenceTags("<outline id=\"unit-1\" name=\"主线\"/>");
    expect(out).toContain(encodeURIComponent("主线"));
  });

  it("未闭合标签剥离标记、保留内部文本", () => {
    const out = extractReferenceTags("<location id=\"loc-7\">青云城");
    expect(out).toContain("青云城");
    expect(out).not.toContain("<location");
  });

  it("未知标签剥离标记、保留内部文本", () => {
    const out = extractReferenceTags("<foo>你好</foo>世界");
    expect(out).toBe("你好世界");
  });

  it("普通尖括号不受影响", () => {
    const out = extractReferenceTags("a < b 且 c > d");
    expect(out).toBe("a < b 且 c > d");
  });
});
