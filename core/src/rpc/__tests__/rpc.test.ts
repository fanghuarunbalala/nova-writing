import { describe, expect, it } from "vitest";
import { expose, wrap } from "kkrpc";
import { createMemoryTransportPair } from "../transport.js";
import { call } from "../call.js";
import { RPCError } from "../RPCError.js";

describe("rpc 内存传输（共享工具）", () => {
	it("expose↔wrap 成功往返 + 参数透传", async () => {
		const [clientT, serverT] = createMemoryTransportPair();
		expose({ add: (a: number, b: number) => a + b }, serverT);
		const api = wrap<{ add(a: number, b: number): Promise<number> }>(clientT);
		expect(await call(() => api.add(1, 2))).toBe(3);
	});

	it("远程抛错 → call 归一成 RPCError(remote)", async () => {
		const [clientT, serverT] = createMemoryTransportPair();
		expose(
			{
				fail: () => {
					throw new Error("boom");
				},
			},
			serverT,
		);
		const api = wrap<{ fail(): Promise<void> }>(clientT);
		await expect(call(() => api.fail())).rejects.toMatchObject({
			name: "RPCError",
			code: "remote",
		});
	});

	it("call 归一本地错误为 RPCError", async () => {
		await expect(
			call(() => {
				throw new Error("local");
			}),
		).rejects.toBeInstanceOf(RPCError);
	});
});
