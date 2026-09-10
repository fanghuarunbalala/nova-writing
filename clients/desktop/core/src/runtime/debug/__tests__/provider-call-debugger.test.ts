import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderCallDebugger } from "../ProviderCallDebugger.js";

function makeCall(n: number) {
  return {
    system: "sys",
    messages: Array.from({ length: n }, (_, i) => ({ role: "user", content: `m${i}` })),
    sampling: { model: "deepseek-v4-flash" },
  };
}

describe("ProviderCallDebugger", () => {
  it("disabled 不写文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "dbg-"));
    const dbg = new ProviderCallDebugger({ enabled: false, dir });
    dbg.record(makeCall(1));
    dbg.close();
    expect(existsSync(join(dir, "provider-calls.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "provider-calls.html"))).toBe(false);
  });

  it("enabled 构造即写 html 头部", () => {
    const dir = mkdtempSync(join(tmpdir(), "dbg-"));
    new ProviderCallDebugger({ enabled: true, dir });
    const html = readFileSync(join(dir, "provider-calls.html"), "utf8");
    expect(html).toContain("Provider Calls");
    expect(html).not.toContain("初次请求");
  });

  it("record 追加 jsonl + html 增量渲染（含相邻差异），close 仅补闭合标签", () => {
    const dir = mkdtempSync(join(tmpdir(), "dbg-"));
    const dbg = new ProviderCallDebugger({ enabled: true, dir });
    dbg.record(makeCall(1));
    dbg.record(makeCall(2));
    const jsonl = readFileSync(join(dir, "provider-calls.jsonl"), "utf8");
    expect(jsonl.split("\n").filter(Boolean)).toHaveLength(2);
    // close 前即可读：常驻进程无自然收尾时机，html 必须随 record 增量可用
    const html = readFileSync(join(dir, "provider-calls.html"), "utf8");
    expect(html).toContain("Provider Calls");
    expect(html).toContain("初次请求");
    expect(html).toContain("新增 Messages"); // 差异：messages 1 → 2
    expect(html).not.toContain("</body></html>");
    dbg.close();
    expect(readFileSync(join(dir, "provider-calls.html"), "utf8")).toContain("</body></html>");
    dbg.close(); // 幂等
    expect(readFileSync(join(dir, "provider-calls.html"), "utf8").match(/<\/body><\/html>/g)).toHaveLength(1);
  });
});
