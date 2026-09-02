import { buildServer } from "./index.js";
import { openDb } from "./db.js";

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.NOVA_DB_PATH ?? "nova.db";
const { app } = await buildServer({ db: openDb(dbPath) });
await app.listen({ port, host: "0.0.0.0" });
console.log(`[nova-server] listening on :${port}, db=${dbPath}`);
