/** SQLite Subagent binding projection with local catch-up-to-live subscriptions. */
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { captureSubagentBinding, type SubagentBinding, type SubagentBindingChange, type SubagentBindingQuery, type SubagentBindingStore, type SubagentBindingSubscription } from "../../../runtime/index.js";

interface BindingRow { binding_json: string; }
interface ChangeRow { sequence: number; binding_json: string; }

export class SqliteSubagentBindingStore implements SubagentBindingStore {
  readonly #subscriptions = new Set<SqliteBindingSubscription>();
  constructor(private readonly database: DatabaseSync) {}
  async put(bindingSource: SubagentBinding): Promise<void> {
    const binding = captureSubagentBinding(bindingSource); const json = JSON.stringify(binding);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO subagent_bindings(subagent_id,parent_conversation_id,parent_run_id,child_conversation_id,status,binding_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(subagent_id) DO UPDATE SET status=excluded.status,binding_json=excluded.binding_json,updated_at=excluded.updated_at`).run(binding.subagentId, binding.parentConversationId, binding.parentRunId, binding.childConversationId, binding.status, json, binding.updatedAt);
      const change = this.database.prepare("INSERT INTO subagent_binding_changes(subagent_id,binding_json,recorded_at) VALUES(?,?,?) RETURNING sequence").get(binding.subagentId, json, binding.updatedAt) as { sequence: number };
      this.database.exec("COMMIT");
      const captured = Object.freeze({ sequence: change.sequence, binding }); for (const subscription of this.#subscriptions) subscription.push(captured);
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  async get(subagentId: string): Promise<SubagentBinding | undefined> { const row = this.database.prepare("SELECT binding_json FROM subagent_bindings WHERE subagent_id = ?").get(subagentId) as BindingRow | undefined; return row ? parseBinding(row.binding_json) : undefined; }
  async list(query: SubagentBindingQuery = {}): Promise<readonly SubagentBinding[]> { const clauses: string[] = []; const params: SQLInputValue[] = []; if (query.parentConversationId !== undefined) { clauses.push("parent_conversation_id = ?"); params.push(query.parentConversationId); } if (query.parentRunId !== undefined) { clauses.push("parent_run_id = ?"); params.push(query.parentRunId); } if (query.activeOnly) clauses.push("status IN ('creating','running')"); const sql = `SELECT binding_json FROM subagent_bindings${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at, subagent_id`; return Object.freeze(((this.database.prepare(sql).all(...params) as unknown) as BindingRow[]).map((row) => parseBinding(row.binding_json))); }
  subscribe(afterSequence = 0): SubagentBindingSubscription { const rows = (this.database.prepare("SELECT sequence,binding_json FROM subagent_binding_changes WHERE sequence > ? ORDER BY sequence").all(afterSequence) as unknown) as ChangeRow[]; const subscription = new SqliteBindingSubscription(rows.map((row) => Object.freeze({ sequence: row.sequence, binding: parseBinding(row.binding_json) })), () => this.#subscriptions.delete(subscription)); this.#subscriptions.add(subscription); return subscription; }
}

class SqliteBindingSubscription implements SubagentBindingSubscription, AsyncIterator<SubagentBindingChange> {
  readonly #queue: SubagentBindingChange[]; readonly #waiters: Array<(value: IteratorResult<SubagentBindingChange>) => void> = []; #closed = false;
  constructor(initial: readonly SubagentBindingChange[], private readonly onClose: () => void) { this.#queue = [...initial]; }
  [Symbol.asyncIterator](): AsyncIterator<SubagentBindingChange> { return this; }
  next(): Promise<IteratorResult<SubagentBindingChange>> { if (this.#queue.length) return Promise.resolve({ done: false, value: this.#queue.shift()! }); if (this.#closed) return Promise.resolve({ done: true, value: undefined }); return new Promise((resolve) => this.#waiters.push(resolve)); }
  push(change: SubagentBindingChange): void { if (this.#closed) return; const waiter = this.#waiters.shift(); if (waiter) waiter({ done: false, value: change }); else this.#queue.push(change); }
  async close(): Promise<void> { if (this.#closed) return; this.#closed = true; this.onClose(); for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined }); }
}

function parseBinding(json: string): SubagentBinding { return captureSubagentBinding(JSON.parse(json)); }
