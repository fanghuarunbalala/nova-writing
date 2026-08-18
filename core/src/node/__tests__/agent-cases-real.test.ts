import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveAgentCasesMasterDir,
  seedAgentCasesIfNeeded,
  scanAgentCases,
  renderAgentCasesIndex,
  clearAgentCasesScanCache,
} from "../workspace/agentCases.js";

/**
 * 真实母版生效检查（core/resources/agent-cases 实文件，非合成数据）：
 * 防手写 front-matter 笔误——真实案例文件解析失败时本测试先红。
 * 断言锚定标签体系而非具体文件数（作者可继续增删案例）。
 */
describe("真实母版生效检查（core/resources/agent-cases）", () => {
  it("向上查找定位母版；seed 后案例可解析、标签体系齐备、order 排序正确、索引可渲染", async () => {
    // 不设 NOVEL_AGENT_CASES_DIR：验证默认向上查找在 src 布局（vitest 从 src 跑）下生效
    delete process.env.NOVEL_AGENT_CASES_DIR;
    const master = await resolveAgentCasesMasterDir();
    expect(master).toBeDefined();

    const ws = await mkdtemp(join(tmpdir(), "agent-cases-real-"));
    try {
      clearAgentCasesScanCache();
      expect(await seedAgentCasesIfNeeded(ws)).toBe(true);
      const entries = await scanAgentCases(ws);
      expect(entries).toBeDefined();
      expect(entries!.length).toBeGreaterThanOrEqual(15);
      const taskTypes = entries!.map((e) => e.taskType);
      // 标签体系齐备：大纲系 + 设定系 + 正文系（作者定稿 15 份的骨架）
      for (const expected of [
        "act-design",
        "scene-design",
        "outline-overview",
        "character-design",
        "world-design",
        "prose-draft",
      ]) {
        expect(taskTypes).toContain(expected);
      }
      expect(taskTypes.some((t) => t.startsWith("prose-") && t !== "prose-draft")).toBe(true);
      // order 序单调不减（act(10) 在 scene(12) 之前等）
      for (let i = 1; i < entries!.length; i++) {
        expect(
          (entries![i - 1].order ?? Number.MAX_SAFE_INTEGER) <=
            (entries![i].order ?? Number.MAX_SAFE_INTEGER),
        ).toBe(true);
      }
      // 索引渲染：路径 + 标签 + 摘要
      const index = renderAgentCasesIndex(entries!);
      expect(index).toContain("task=act-design");
      expect(index).toContain("正文撰写案例");
    } finally {
      clearAgentCasesScanCache();
      await rm(ws, { recursive: true, force: true });
    }
  });
});
