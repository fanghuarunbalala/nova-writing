// smoke 父进程：spawn child，经 stdio 跑通 novel query / mutate / novel.changed（callback 订阅）
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createStdioTransport } from "../dist/rpc/transport.js";
import { NovelHandle } from "../dist/novel/client/NovelHandle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [join(__dirname, "novel-db-stdio-child.mjs")], {
	stdio: ["pipe", "pipe", "inherit"],
});
const transport = createStdioTransport({ readable: child.stdout, writable: child.stdin });
const handle = new NovelHandle(transport);

try {
	// query 往返
	const overview = await handle.query({ op: "overview.get" });
	console.log("SMOKE overview:", JSON.stringify(overview));
	if (overview.novelId !== "n1") throw new Error("overview.novelId 不符");

	// callback 订阅 novel.changed → mutate → 收到事件
	const received = [];
	const subId = await handle.subscribeChanges((evt) => received.push(evt));
	await new Promise((r) => setTimeout(r, 50)); // 等 callback 注册送达
	const result = await handle.mutate({ op: "character.create", input: { name: "主角" } });
	await new Promise((r) => setTimeout(r, 50)); // 等 callback 推送送达
	await handle.unsubscribeChanges(subId);

	console.log("SMOKE mutate:", JSON.stringify(result));
	console.log("SMOKE novel.changed:", JSON.stringify(received[0]));
	if (received[0]?.entity !== "character" || received[0]?.op !== "character.create") {
		throw new Error("novel.changed 事件不符");
	}

	console.log("SMOKE OK");
} catch (err) {
	console.error("SMOKE ERROR:", err);
	process.exitCode = 1;
} finally {
	handle.dispose();
	child.kill();
}
