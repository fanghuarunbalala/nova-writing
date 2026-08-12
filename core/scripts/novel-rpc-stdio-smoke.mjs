// smoke 父进程：spawn child，stdio RPC query/mutate + ZeroMQ SUB novel.changed
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createStdioTransport } from "../dist/rpc/transport.js";
import { EventSubscriber } from "../dist/event/EventSubscriber.js";
import { NovelHandle } from "../dist/novel/client/NovelHandle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [join(__dirname, "novel-db-stdio-child.mjs")], {
	stdio: ["pipe", "pipe", "inherit"],
});
const transport = createStdioTransport({ readable: child.stdout, writable: child.stdin });
const handle = new NovelHandle(transport);

const novelSub = new EventSubscriber("ipc://novel-events-smoke3", ["novel.changed"]);
await novelSub.connect();
await new Promise((r) => setTimeout(r, 600)); // slow joiner + 等 child 起好

try {
	// query 往返（stdio RPC）
	const overview = await handle.query({ op: "overview.get" });
	console.log("SMOKE overview:", JSON.stringify(overview));
	if (overview.novelId !== "n1") throw new Error("overview.novelId 不符");

	// mutate（stdio RPC）→ novel.changed（ZeroMQ）
	const recv = (async () => {
		for await (const evt of novelSub) return evt;
	})();
	const result = await handle.mutate({ op: "character.create", input: { name: "主角" } });
	const evt = await recv;

	console.log("SMOKE mutate:", JSON.stringify(result));
	console.log("SMOKE novel.changed:", JSON.stringify(evt.payload));
	if (evt.payload?.entity !== "character" || evt.payload?.op !== "character.create") {
		throw new Error("novel.changed 事件不符");
	}

	console.log("SMOKE OK");
} catch (err) {
	console.error("SMOKE ERROR:", err);
	process.exitCode = 1;
} finally {
	handle.dispose();
	await novelSub.close();
	child.kill();
}
