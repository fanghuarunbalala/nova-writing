import { describe, it, expect } from "vitest";
import { ComposeModeStateProvider, ComposeStateError } from "../ComposeModeState.js";

describe("ComposeModeStateProvider", () => {
  it("enter → submit → approve：designing → pending → applied，恢复 preMode", () => {
    const p = new ComposeModeStateProvider();
    const entered = p.enter("c1", { designFilePath: "/d.md", preComposeMode: "bypass" });
    expect(entered).toMatchObject({ phase: "designing", active: true, mode: "compose" });
    p.submit("c1");
    expect(p.snapshot("c1").phase).toBe("pending");
    const approved = p.approve("c1");
    expect(approved).toMatchObject({ phase: "applied", active: false, mode: "bypass" });
  });

  it("discard：designing → discarded，恢复 preMode", () => {
    const p = new ComposeModeStateProvider();
    p.enter("c1", { designFilePath: "/d.md", preComposeMode: "review" });
    const discarded = p.discard("c1");
    expect(discarded).toMatchObject({ phase: "discarded", active: false, mode: "review" });
  });

  it("reject：pending → designing（active 保持）", () => {
    const p = new ComposeModeStateProvider();
    p.enter("c1", { designFilePath: "/d.md" });
    p.submit("c1");
    const rejected = p.reject("c1");
    expect(rejected).toMatchObject({ phase: "designing", active: true });
  });

  it("非法转换抛 ComposeStateError（approve 需 designing/pending）", () => {
    const p = new ComposeModeStateProvider();
    expect(() => p.approve("c1")).toThrow(ComposeStateError);
  });

  it("重复 enter 抛错（compose 已激活）", () => {
    const p = new ComposeModeStateProvider();
    p.enter("c1", { designFilePath: "/d.md" });
    expect(() => p.enter("c1", { designFilePath: "/e.md" })).toThrow(ComposeStateError);
  });

  it("enter 透传 hasPriorDraft 标记（旧草稿探测）", () => {
    const p = new ComposeModeStateProvider();
    const entered = p.enter("c1", { designFilePath: "/d.md", hasPriorDraft: true });
    expect(entered.hasPriorDraft).toBe(true);
    const fresh = new ComposeModeStateProvider();
    const clean = fresh.enter("c2", { designFilePath: "/e.md" });
    expect(clean.hasPriorDraft).toBeUndefined();
  });

  it("settle：清除 designFilePath/preComposeMode，保留终态（applied）", () => {
    const p = new ComposeModeStateProvider();
    p.enter("c1", { designFilePath: "/d.md", preComposeMode: "bypass", hasPriorDraft: false });
    p.approve("c1");
    const settled = p.settle("c1");
    expect(settled).toEqual({ phase: "applied", active: false, mode: "bypass" });
    expect(settled.designFilePath).toBeUndefined();
    expect(settled.preComposeMode).toBeUndefined();
  });

  it("settle：discard 后同样收口", () => {
    const p = new ComposeModeStateProvider();
    p.enter("c1", { designFilePath: "/d.md", preComposeMode: "review" });
    p.discard("c1");
    const settled = p.settle("c1");
    expect(settled).toEqual({ phase: "discarded", active: false, mode: "review" });
  });
});
