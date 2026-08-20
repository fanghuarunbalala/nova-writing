/**
 * skills.setDisabled 配置域测试：契约 op + 双 store（InMemory / NodeApplicationConfigStore）
 * 持久化往返 + 校验（非法技能名拒绝、去重、损坏文件回退）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryConfigStore } from "../InMemoryConfigStore.js";
import { NodeApplicationConfigStore } from "../../node/config/NodeApplicationConfigStore.js";
import { validateSkillsDisabled } from "../skillsSettings.js";
import type { CredentialCipher } from "../CredentialCipher.js";

/** 明文直通 cipher（测试） */
const plainCipher: CredentialCipher = {
  encrypt: async (s) => s,
  decrypt: async (s) => s,
};

describe("validateSkillsDisabled", () => {
  it("去重并保序", () => {
    expect(validateSkillsDisabled(["a", "b", "a"])).toEqual(["a", "b"]);
    expect(validateSkillsDisabled([])).toEqual([]);
  });

  it("非法技能名拒绝（大写/下划线/超长/非字符串）", () => {
    expect(() => validateSkillsDisabled(["Bad_Name"])).toThrowError(/非法技能名/);
    expect(() => validateSkillsDisabled(["x".repeat(65)])).toThrowError(/非法技能名/);
    expect(() => validateSkillsDisabled([""])).toThrowError(/非法技能名/);
  });
});

describe("InMemoryConfigStore skills.setDisabled", () => {
  it("op 落内存并出现在快照", async () => {
    const store = new InMemoryConfigStore();
    await store.mutate({ op: "skills.setDisabled", names: ["a", "b"] });
    expect((await store.get()).skillsDisabled).toEqual(["a", "b"]);
    await store.mutate({ op: "skills.setDisabled", names: [] });
    expect((await store.get()).skillsDisabled).toEqual([]);
  });

  it("非法名单抛错且不影响既有值", async () => {
    const store = new InMemoryConfigStore();
    await store.mutate({ op: "skills.setDisabled", names: ["a"] });
    await expect(store.mutate({ op: "skills.setDisabled", names: ["BAD"] })).rejects.toThrowError(
      /非法技能名/,
    );
    expect((await store.get()).skillsDisabled).toEqual(["a"]);
  });
});

describe("NodeApplicationConfigStore skills.setDisabled", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "novel-config-skills-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("落盘并重启往返", async () => {
    const filePath = join(dir, "config.json");
    const store = new NodeApplicationConfigStore({ filePath, cipher: plainCipher });
    await store.load();
    await store.mutate({ op: "skills.setDisabled", names: ["alpha", "beta"] });
    const reopened = new NodeApplicationConfigStore({ filePath, cipher: plainCipher });
    await reopened.load();
    expect((await reopened.get()).skillsDisabled).toEqual(["alpha", "beta"]);
  });

  it("空名单不落 skillsDisabled 字段（缺省全启用语义）", async () => {
    const filePath = join(dir, "config.json");
    const store = new NodeApplicationConfigStore({ filePath, cipher: plainCipher });
    await store.load();
    await store.mutate({ op: "skills.setDisabled", names: ["x"] });
    await store.mutate({ op: "skills.setDisabled", names: [] });
    const reopened = new NodeApplicationConfigStore({ filePath, cipher: plainCipher });
    await reopened.load();
    expect((await reopened.get()).skillsDisabled).toEqual([]);
  });

  it("损坏的名单字段回退全启用（不影响 profiles）", async () => {
    const filePath = join(dir, "config.json");
    await writeFile(
      filePath,
      JSON.stringify({
        profiles: [],
        credentials: {},
        skillsDisabled: ["BAD NAME!"],
      }),
      "utf8",
    );
    const store = new NodeApplicationConfigStore({ filePath, cipher: plainCipher });
    await store.load();
    expect((await store.get()).skillsDisabled).toBeUndefined();
  });
});
