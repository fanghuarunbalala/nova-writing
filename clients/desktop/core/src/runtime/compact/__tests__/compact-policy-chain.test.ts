import { describe, it, expect, vi } from "vitest";
import { CompactPolicyChainImpl } from "../CompactPolicyChainImpl.js";
import type { ContextCompactPolicy } from "../ContextCompactPolicy.js";

function makePolicy(should: boolean, compacts: boolean) {
  return {
    shouldCompact: vi.fn(() => should),
    compact: vi.fn(async () => compacts),
  } as unknown as ContextCompactPolicy;
}

describe("CompactPolicyChainImpl", () => {
  it("按优先级降序执行，高优先级压缩后短路", async () => {
    const chain = new CompactPolicyChainImpl();
    const low = makePolicy(true, false);
    const high = makePolicy(true, true);
    chain.register(low, 1);
    chain.register(high, 10);
    const loop = {} as never;
    await expect(chain.compactIfNeeded(loop)).resolves.toBe(true);
    expect(high.shouldCompact).toHaveBeenCalled();
    expect(low.shouldCompact).not.toHaveBeenCalled(); // 高优先级已压缩，短路
  });

  it("shouldCompact 通过但 compact 未实际压缩时继续链", async () => {
    const chain = new CompactPolicyChainImpl();
    const noOp = makePolicy(true, false);
    const next = makePolicy(true, true);
    chain.register(noOp, 10);
    chain.register(next, 1);
    await expect(chain.compactIfNeeded({} as never)).resolves.toBe(true);
    expect(noOp.compact).toHaveBeenCalled();
    expect(next.compact).toHaveBeenCalled(); // 前序未实际压缩，链继续
  });

  it("全部不压缩返回 false", async () => {
    const chain = new CompactPolicyChainImpl();
    chain.register(makePolicy(false, false), 1);
    chain.register(makePolicy(false, false), 2);
    await expect(chain.compactIfNeeded({} as never)).resolves.toBe(false);
  });

  it("unregister 移除策略", async () => {
    const chain = new CompactPolicyChainImpl();
    const p = makePolicy(true, true);
    chain.register(p, 1);
    chain.unregister(p);
    await expect(chain.compactIfNeeded({} as never)).resolves.toBe(false);
  });
});
