import { describe, it, expect } from "vitest";
import {
  MaxTurnNudgePolicy,
  MAX_TURN_NUDGE_MARK,
  MAX_TURN_FINAL_NUDGE_MARK,
  DEFAULT_WARN_WINDOW,
  renderMaxTurnText,
  renderMaxTurnFinalText,
} from "../definitions/max-turn.js";
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunProgress } from "../../loop/types.js";
import type { LLMessage, ProviderCall } from "../../provider/types.js";

/** LoopContext 替身：state 可变（测试中改 generation / runsMessages）；记录 append */
function makeLoop(state: { generation: number; runsMessages: LLMessage[][] }) {
  const appended: LLMessage[] = [];
  const loop = {
    appendRunMessages: (messages: LLMessage[]) => {
      appended.push(...messages);
    },
    get compactionGeneration() {
      return state.generation;
    },
    get messages() {
      return state.runsMessages.flat();
    },
    get runs() {
      return state.runsMessages.map((messages) => ({ messages }));
    },
  } as unknown as LoopContext;
  return { loop, appended };
}

function makeRun(curTurn = 0, maxTurn = 100): RunProgress {
  return { curTurn, maxTurn, toolsLastTurn: new Map() };
}

describe("renderMaxTurnText / renderMaxTurnFinalText", () => {
  it("warn 文案：已消耗 / 剩余（含本轮）/ 总预算数值正确；默认窗口 3", () => {
    expect(DEFAULT_WARN_WINDOW).toBe(3);
    const text = renderMaxTurnText(97, 100);
    expect(text).toContain("已消耗 97 轮");
    expect(text).toContain("剩余 3 轮（含本轮，总预算 100 轮）");
    expect(text).toContain("不要静默中断");
  });

  it("final 文案：最后一轮 + 禁止再调工具 + 轮次计数", () => {
    const text = renderMaxTurnFinalText(99, 100);
    expect(text).toContain("最后一轮");
    expect(text).toContain("第 100 轮 / 共 100 轮");
    expect(text).toContain("不要再调用任何工具");
  });
});

describe("MaxTurnNudgePolicy", () => {
  it("未到 warn 窗口（remaining=4）：no-op，不注入", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(96))).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it("进入 warn 窗口（remaining=3）：注入 system 消息，标记 max_turn，文案数值正确", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(97))).toBe(true);
    expect(appended).toHaveLength(1);
    const message = appended[0]!;
    expect(message.role).toBe("system");
    expect(message.nudge).toBe(MAX_TURN_NUDGE_MARK);
    expect(message.content).toContain("剩余 3 轮（含本轮");
  });

  it("warn 每 run 一次：窗口内后续 turn 不再注入", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(97))).toBe(true);
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(98))).toBe(false);
    expect(appended).toHaveLength(1);
  });

  it("final 窗口（remaining=1）：注入 max_turn_final 标记消息", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(99))).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.nudge).toBe(MAX_TURN_FINAL_NUDGE_MARK);
  });

  it("两级共存：97 注 warn → 98 静默 → 99 注 final，标记各归各", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(97))).toBe(true);
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(98))).toBe(false);
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(99))).toBe(true);
    expect(appended).toHaveLength(2);
    expect(appended[0]!.nudge).toBe(MAX_TURN_NUDGE_MARK);
    expect(appended[1]!.nudge).toBe(MAX_TURN_FINAL_NUDGE_MARK);
  });

  it("maxTurn=1 塌缩：首轮即末轮，只注 final 不注 warn", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(0, 1))).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.nudge).toBe(MAX_TURN_FINAL_NUDGE_MARK);
  });

  it("maxTurn=2：首轮 warn、次轮 final", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(0, 2))).toBe(true);
    expect(appended[0]!.nudge).toBe(MAX_TURN_NUDGE_MARK);
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(1, 2))).toBe(true);
    expect(appended[1]!.nudge).toBe(MAX_TURN_FINAL_NUDGE_MARK);
  });

  it("新 run 复位：curTurn 回 0 后再次进窗口重新注入", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(97))).toBe(true);
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(0))).toBe(false);
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(97))).toBe(true);
    expect(appended).toHaveLength(2);
  });

  it("压缩纪元变化且窗口仍在：清扫后重注一次 warn", () => {
    const state = { generation: 0, runsMessages: [] as LLMessage[][] };
    const { loop, appended } = makeLoop(state);
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(97))).toBe(true);
    state.generation = 1;
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(98))).toBe(true);
    expect(appended).toHaveLength(2);
    expect(appended[1]!.nudge).toBe(MAX_TURN_NUDGE_MARK);
  });

  it("纪元变化但出窗口：不注入", () => {
    const state = { generation: 0, runsMessages: [] as LLMessage[][] };
    const { loop, appended } = makeLoop(state);
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(96))).toBe(false);
    state.generation = 1;
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(96))).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it("messages 非空→空（clear 兜底）：复位后窗口内重注", () => {
    const state = {
      generation: 0,
      runsMessages: [[{ role: "user", content: "hi" }] as LLMessage[]],
    };
    const { loop, appended } = makeLoop(state);
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(97))).toBe(true);
    state.runsMessages = [];
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(98))).toBe(true);
    expect(appended).toHaveLength(2);
    expect(appended[1]!.nudge).toBe(MAX_TURN_NUDGE_MARK);
  });

  it("重启已压缩会话：首求值 generation=5 且当前 run 已含 warn 标记 → 不重发（纪元基线修复回归）", () => {
    const { loop, appended } = makeLoop({
      generation: 5,
      runsMessages: [
        [{ role: "system", content: "旧提醒", nudge: MAX_TURN_NUDGE_MARK }],
      ],
    });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(98))).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it("seed 区分两级：当前 run 已含 warn 标记，remaining=1 仍注 final", () => {
    const { loop, appended } = makeLoop({
      generation: 0,
      runsMessages: [
        [{ role: "system", content: "旧提醒", nudge: MAX_TURN_NUDGE_MARK }],
      ],
    });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(99))).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.nudge).toBe(MAX_TURN_FINAL_NUDGE_MARK);
  });

  it("旧 run 的标记不阻塞当前 run：正常注入", () => {
    const { loop, appended } = makeLoop({
      generation: 0,
      runsMessages: [
        [{ role: "system", content: "上一 run 的提醒", nudge: MAX_TURN_NUDGE_MARK }],
        [],
      ],
    });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(97))).toBe(true);
    expect(appended).toHaveLength(1);
  });

  it("子代理典型窗口（maxTurn=20）：17 注 warn、19 注 final", () => {
    const { loop, appended } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(17, 20))).toBe(true);
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(18, 20))).toBe(false);
    expect(policy.persistentNudgeIfNeeded(loop, makeRun(19, 20))).toBe(true);
    expect(appended).toHaveLength(2);
    expect(appended[0]!.nudge).toBe(MAX_TURN_NUDGE_MARK);
    expect(appended[1]!.nudge).toBe(MAX_TURN_FINAL_NUDGE_MARK);
  });

  it("transient 通道不使用（恒 false）", () => {
    const { loop } = makeLoop({ generation: 0, runsMessages: [] });
    const policy = new MaxTurnNudgePolicy();
    expect(policy.transientNudgeIfNeeded(loop, makeRun(99), {} as ProviderCall)).toBe(false);
  });
});
