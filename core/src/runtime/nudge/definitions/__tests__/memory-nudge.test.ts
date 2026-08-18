import { describe, it, expect, vi } from "vitest";
import { MemoryNudgePolicy, MEMORY_NUDGE_FULL, MEMORY_NUDGE_DELTA } from "../memory.js";
import type { LoopContext } from "../../../loop/LoopContext.js";
import type { RunProgress } from "../../../loop/types.js";
import type { MemoryFileReader } from "../../../../memory/index.js";

const INDEX_V3 = `version: 3
prose:
  - name: 战斗
    desc: 短兵相接的近身打斗与攻防节奏段落
    path: .novel/references/prose/combat.yaml
`;

const INDEX_V4_ADDED = `version: 4
prose:
  - name: 战斗
    desc: 短兵相接的近身打斗与攻防节奏段落
    path: .novel/references/prose/combat.yaml
  - name: 对话
    desc: 交锋式对话段落
    path: .novel/references/prose/dialogue.yaml
`;

const PROSE_FILE = `kind: prose
name: 战斗
desc: 短兵相接的近身打斗与攻防节奏段落
updated: 2026-08-18
entries:
  - id: "001"
    source: paste
    added: 2026-08-18
    text: |
      三段轻功掠过檐角。
`;

type Files = Record<string, string>;

/** 可变文件状态 + 实时读取器 + 记录自愈写回 */
function statefulWorkspace(initial: Files) {
  const files: Files = { ...initial };
  const writes: string[] = [];
  const reader: MemoryFileReader = {
    read: async (rel) => files[rel],
    list: async (dir) =>
      Object.keys(files)
        .filter((f) => f.startsWith(`${dir}/`))
        .sort(),
  };
  return {
    files,
    writes,
    reader,
    writeIndex: async (text: string) => {
      writes.push(text);
      files["MEMORY.yaml"] = text;
    },
  };
}

type AppendedMessage = { role: "system"; content: string; nudge?: string };

function mockLoop(opts: {
  generation?: number;
  messages?: Array<{ role: string; content: string }>;
  runs?: Array<{ messages: Array<{ role: string; content: string; nudge?: string }> }>;
} = {}) {
  const appended: AppendedMessage[] = [];
  const loop = {
    compactionGeneration: opts.generation ?? 0,
    messages: opts.messages ?? [{ role: "user", content: "hi" }],
    runs: (opts.runs ?? [{ messages: [{ role: "user", content: "hi" }] }]).map((r) => ({
      messages: [...r.messages],
    })),
    appendRunMessages: vi.fn((ms: AppendedMessage[]) => {
      appended.push(...ms);
    }),
  } as unknown as LoopContext;
  return { loop, appended };
}

function run(curTurn = 0): RunProgress {
  return { curTurn, maxTurn: 100, toolsLastTurn: new Map() };
}

describe("MemoryNudgePolicy(纪元注入 + version/摘要自愈)", () => {
  it("无 MEMORY.yaml:纪元首 run 注入空目录;之后不重发", async () => {
    const ws = statefulWorkspace({});
    const policy = new MemoryNudgePolicy({ workspace: "ws", reader: ws.reader, writeIndex: ws.writeIndex });
    const { loop, appended } = mockLoop();
    await policy.persistentNudgeIfNeeded(loop, run());
    expect(appended).toHaveLength(1);
    expect(appended[0]!.nudge).toBe(MEMORY_NUDGE_FULL);
    expect(appended[0]!.content).toContain("尚无任何案例");
    appended.length = 0;
    expect(await policy.persistentNudgeIfNeeded(loop, run())).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it("纪元内 agent 正确 bump version → 追加 delta 通知(±类目)", async () => {
    const ws = statefulWorkspace({
      "MEMORY.yaml": INDEX_V3,
      ".novel/references/prose/combat.yaml": PROSE_FILE,
    });
    const policy = new MemoryNudgePolicy({ workspace: "ws", reader: ws.reader, writeIndex: ws.writeIndex });
    const { loop, appended } = mockLoop();
    await policy.persistentNudgeIfNeeded(loop, run());
    expect(appended[0]!.content).toContain('<memory version="3">');
    appended.length = 0;
    ws.files["MEMORY.yaml"] = INDEX_V4_ADDED;
    ws.files[".novel/references/prose/dialogue.yaml"] = PROSE_FILE.replace(/战斗/g, "对话");
    expect(await policy.persistentNudgeIfNeeded(loop, run())).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.nudge).toBe(MEMORY_NUDGE_DELTA);
    expect(appended[0]!.content).toContain("v4");
    expect(appended[0]!.content).toContain("+prose:对话");
    expect(ws.writes).toHaveLength(0); // agent 已 bump,不自愈
  });

  it("纪元内改内容未 bump version → 自愈 version+1 写回 + 通知", async () => {
    const ws = statefulWorkspace({
      "MEMORY.yaml": INDEX_V3,
      ".novel/references/prose/combat.yaml": PROSE_FILE,
    });
    const policy = new MemoryNudgePolicy({ workspace: "ws", reader: ws.reader, writeIndex: ws.writeIndex });
    const { loop, appended } = mockLoop();
    await policy.persistentNudgeIfNeeded(loop, run());
    appended.length = 0;
    // 内容改了(加对话类目)但 version 仍是 3
    const forgot = INDEX_V4_ADDED.replace("version: 4", "version: 3");
    ws.files["MEMORY.yaml"] = forgot;
    ws.files[".novel/references/prose/dialogue.yaml"] = PROSE_FILE.replace(/战斗/g, "对话");
    expect(await policy.persistentNudgeIfNeeded(loop, run())).toBe(true);
    expect(ws.writes).toHaveLength(1);
    expect(ws.writes[0]).toContain("version: 4");
    expect(appended[0]!.content).toContain("已更新至 v4");
  });

  it("compact 纪元重置 → 重注入当前目录全文", async () => {
    const ws = statefulWorkspace({
      "MEMORY.yaml": INDEX_V3,
      ".novel/references/prose/combat.yaml": PROSE_FILE,
    });
    const policy = new MemoryNudgePolicy({ workspace: "ws", reader: ws.reader, writeIndex: ws.writeIndex });
    const gen0 = mockLoop({ generation: 0 });
    await policy.persistentNudgeIfNeeded(gen0.loop, run());
    const gen1 = mockLoop({ generation: 1 });
    expect(await policy.persistentNudgeIfNeeded(gen1.loop, run())).toBe(true);
    expect(gen1.appended).toHaveLength(1);
    expect(gen1.appended[0]!.nudge).toBe(MEMORY_NUDGE_FULL);
  });

  it("clear 兜底(messages 非空→空)→ 重注入", async () => {
    const ws = statefulWorkspace({});
    const policy = new MemoryNudgePolicy({ workspace: "ws", reader: ws.reader, writeIndex: ws.writeIndex });
    const first = mockLoop({ messages: [{ role: "user", content: "hi" }] });
    await policy.persistentNudgeIfNeeded(first.loop, run());
    const afterClear = mockLoop({ messages: [] });
    expect(await policy.persistentNudgeIfNeeded(afterClear.loop, run())).toBe(true);
    expect(afterClear.appended[0]!.nudge).toBe(MEMORY_NUDGE_FULL);
  });

  it("preset 变更 → 独立通知,不 bump version", async () => {
    const ws = statefulWorkspace({
      "MEMORY.yaml": INDEX_V3,
      ".novel/references/prose/combat.yaml": PROSE_FILE,
    });
    const policy = new MemoryNudgePolicy({ workspace: "ws", reader: ws.reader, writeIndex: ws.writeIndex });
    const { loop, appended } = mockLoop();
    await policy.persistentNudgeIfNeeded(loop, run());
    appended.length = 0;
    ws.files[".novel/preset/story/复仇.yaml"] = PROSE_FILE.replace(/prose/g, "story").replace(
      /战斗/g,
      "复仇",
    );
    expect(await policy.persistentNudgeIfNeeded(loop, run())).toBe(true);
    expect(appended[0]!.content).toContain("预设已变更");
    expect(appended[0]!.content).toContain("story/复仇.yaml");
    expect(ws.writes).toHaveLength(0);
  });

  it("重启 seed-scan:已注入 memory_full → 不重发、不误报变更", async () => {
    const ws = statefulWorkspace({
      "MEMORY.yaml": INDEX_V3,
      ".novel/references/prose/combat.yaml": PROSE_FILE,
    });
    const renderedFull = `<memory version="3">\n- prose · 战斗\n</memory>`;
    const policy = new MemoryNudgePolicy({ workspace: "ws", reader: ws.reader, writeIndex: ws.writeIndex });
    const { loop, appended } = mockLoop({
      runs: [{ messages: [{ role: "system", content: renderedFull, nudge: MEMORY_NUDGE_FULL }] }],
    });
    expect(await policy.persistentNudgeIfNeeded(loop, run())).toBe(false);
    expect(appended).toHaveLength(0);
    expect(ws.writes).toHaveLength(0);
  });

  it("curTurn≠0 不求值;校验失败注入修复指引", async () => {
    const ws = statefulWorkspace({ "MEMORY.yaml": "version: [broken" });
    const policy = new MemoryNudgePolicy({ workspace: "ws", reader: ws.reader, writeIndex: ws.writeIndex });
    const { loop, appended } = mockLoop();
    expect(await policy.persistentNudgeIfNeeded(loop, run(3))).toBe(false);
    expect(appended).toHaveLength(0);
    expect(await policy.persistentNudgeIfNeeded(loop, run())).toBe(true);
    expect(appended[0]!.content).toContain("校验未通过");
  });
});
