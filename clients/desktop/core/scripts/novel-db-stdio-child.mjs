// smoke 子进程：novel-db over stdio（query/mutate RPC）+ ZeroMQ PUB（novel.changed）
import { createStdioTransport } from "../dist/rpc/transport.js";
import { EventPublisher } from "../dist/event/EventPublisher.js";
import { NovelDbServer } from "../dist/novel/server/NovelDbServer.js";

const store = {
	async query(q) {
		switch (q.op) {
			case "overview.get":
				return {
					novelId: "n1",
					title: "smoke 小说",
					counts: { storyUnits: 0, characters: 1, locations: 0, paragraphs: 0 },
				};
			default:
				throw new Error("unhandled query: " + q.op);
		}
	},
	async mutate(m) {
		if (m.op === "character.create") {
			return { version: 1, changeId: "c-smoke", entity: "character" };
		}
		throw new Error("unhandled mutation: " + m.op);
	},
};

const pub = new EventPublisher("ipc://novel-events-smoke3");
await pub.bind();
console.error("[child] novel-events publisher bound");

const transport = createStdioTransport({
	readable: process.stdin,
	writable: process.stdout,
});
const server = new NovelDbServer(store, pub);
await server.start(transport);
console.error("[child] novel-db server ready");
process.stdin.on("end", () => process.exit(0));
