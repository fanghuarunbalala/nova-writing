import { describe, it, expect, vi } from "vitest";
import { createCharacterTools } from "../novel.js";
import type { NovelHandle } from "../../../../novel/client/NovelHandle.js";
import type { ToolCall } from "../../../provider/types.js";

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "c1", name, args: JSON.stringify(args) };
}

function mockHandle(): { handle: NovelHandle; query: ReturnType<typeof vi.fn>; mutate: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue([]);
  const mutate = vi.fn().mockResolvedValue({ ok: true });
  const handle = { query, mutate } as unknown as NovelHandle;
  return { handle, query, mutate };
}

describe("createCharacterTools", () => {
  it("Read 无 id → characters.list", async () => {
    const { handle, query } = mockHandle();
    const read = createCharacterTools(handle).find((t) => t.name === "CharacterRead")!;
    await read.handler.execute(call("CharacterRead", {}));
    expect(query).toHaveBeenCalledWith({ op: "characters.list" });
  });

  it("Read 有 id → characters.get", async () => {
    const { handle, query } = mockHandle();
    const read = createCharacterTools(handle).find((t) => t.name === "CharacterRead")!;
    await read.handler.execute(call("CharacterRead", { characterId: "c1" }));
    expect(query).toHaveBeenCalledWith({ op: "characters.get", characterId: "c1" });
  });

  it("Write → character.create", async () => {
    const { handle, mutate } = mockHandle();
    const write = createCharacterTools(handle).find((t) => t.name === "CharacterWrite")!;
    await write.handler.execute(call("CharacterWrite", { values: [{ name: "林默" }] }));
    expect(mutate).toHaveBeenCalledWith({ op: "character.create", input: { name: "林默" } });
  });

  it("Edit → character.update（patch 透传）", async () => {
    const { handle, mutate } = mockHandle();
    const edit = createCharacterTools(handle).find((t) => t.name === "CharacterEdit")!;
    await edit.handler.execute(
      call("CharacterEdit", { values: [{ characterId: "c1", patch: { summary: "剑客" } }] }),
    );
    expect(mutate).toHaveBeenCalledWith({ op: "character.update", characterId: "c1", patch: { summary: "剑客" } });
  });
});
