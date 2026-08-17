import { describe, it, expect } from "vitest";
import { reorderToolResults } from "../toolSequenceGuard.js";
import type { LLMessage } from "../../provider/types.js";

/** 消息构造器（紧凑用例） */
const u = (t: string): LLMessage => ({ role: "user", content: t });
const sys = (t: string): LLMessage => ({ role: "system", content: t });
const a = (...ids: string[]): LLMessage => ({
  role: "assistant",
  content: "",
  ...(ids.length > 0
    ? { toolCalls: ids.map((id) => ({ id, name: "T", args: "{}" })) }
    : {}),
});
const t = (id: string): LLMessage => ({ role: "tool", content: `r:${id}`, id });

describe("reorderToolResults", () => {
  it("合法序列原样返回（同一引用，零分配）", () => {
    const messages = [u("hi"), a("q1"), t("q1"), a("q2", "q3"), t("q2"), t("q3"), a(), u("again")];
    expect(reorderToolResults(messages)).toBe(messages);
  });

  it("user 插在 assistant(toolCalls) 与 tool result 之间 → result 前移，user 后移", () => {
    const messages = [u("hi"), a("q1"), u("追发"), t("q1")];
    const out = reorderToolResults(messages);
    expect(out).toEqual([u("hi"), a("q1"), t("q1"), u("追发")]);
  });

  it("system 隔断 + 多 toolCalls → result 组按 toolCalls 顺序归位，隔断消息保持相对顺序", () => {
    const messages = [a("q1", "q2"), sys("提醒"), u("追发"), t("q2"), t("q1")];
    const out = reorderToolResults(messages);
    expect(out).toEqual([a("q1", "q2"), t("q1"), t("q2"), sys("提醒"), u("追发")]);
  });

  it("两个 assistant 块交叉错位 → 各自归位", () => {
    const messages = [a("q1"), a("q2"), t("q1"), t("q2")];
    const out = reorderToolResults(messages);
    expect(out).toEqual([a("q1"), t("q1"), a("q2"), t("q2")]);
  });

  it("缺失 tool result（后续不存在）→ 不触发重排，原样返回", () => {
    const messages = [a("q1"), u("之后")];
    expect(reorderToolResults(messages)).toBe(messages);
  });

  it("部分缺失 + 部分错位 → 只归位存在的 result", () => {
    const messages = [a("q1", "q2"), u("追发"), t("q1")];
    const out = reorderToolResults(messages);
    expect(out).toEqual([a("q1", "q2"), t("q1"), u("追发")]);
  });

  it("journal 坏序列实例（assistant → user → tool + 尾部 nudge system）→ 修正", () => {
    const messages = [
      u("第一卷怎么定"),
      a("q1"),
      u("不行，可以只先确定第一卷"),
      t("q1"),
      sys("【项目状态】……"),
      sys("待办列表维护提醒"),
    ];
    const out = reorderToolResults(messages);
    expect(out.slice(0, 4)).toEqual([u("第一卷怎么定"), a("q1"), t("q1"), u("不行，可以只先确定第一卷")]);
    expect(out.slice(4)).toEqual([sys("【项目状态】……"), sys("待办列表维护提醒")]);
  });

  it("result 出现在所属 assistant 之前（孤儿）→ 不移动，序列保持", () => {
    const messages = [t("q1"), a("q1"), u("x")];
    const out = reorderToolResults(messages);
    expect(out).toEqual([t("q1"), a("q1"), u("x")]);
  });

  it("空序列 / 无 toolCalls 的序列原样返回", () => {
    expect(reorderToolResults([])).toEqual([]);
    const plain = [u("hi"), a()];
    expect(reorderToolResults(plain)).toBe(plain);
  });
});
