/**
 * CCB 主 agent 参考 prompt 对齐冒烟。
 *
 * 验证：
 * 1. createDefaultPromptSectionRegistry 包含全部 ccb.reference.* 静态段；
 * 2. ccb_main_reference AgentDefinition 按 CCB 顺序组装 6 个静态段；
 * 3. 每段 render() 输出与固化快照 digest 逐字一致（一字不差回归保护）；
 * 4. 组装结果包含关键标记（System / Doing tasks / Actions / Using your tools）。
 *
 * 快照 digest 取自 CCB @ 2ccc216 对应函数的输出（见各段中文注释）。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PromptCapabilitySnapshot,
  SystemPromptBuilder,
  ccbMainReferenceAgentDefinition,
  createDefaultPromptSectionRegistry,
} from "../dist/index.js";

class Sha256PromptDigester {
  algorithm = "sha256";

  async digest(content) {
    return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
  }
}

function digestOf(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// CCB 原文快照 digest（逐字锁定）。
const EXPECTED_SECTION_DIGESTS = {
  "ccb.reference.intro": "c43f147b84290c24b7c3b6480e00f1dada9c8f6f103ff460612b4ae30de44bd9",
  "ccb.reference.system": "1dd49c85d504acd08f89c4ef707e3fabf12fbbc2c73e40c8533c0a733949ddfc",
  "ccb.reference.doing-tasks": "6fd902acae9668841038463062f220e5579fe497164417eb958f96cee7b231c7",
  "ccb.reference.actions": "52bb1c4d43f5b10ea1ec73a72629655ab3d8ac7852d3c8002ee02da7f98386d5",
  "ccb.reference.using-tools": "9e06b9ffe17dc495dda009eafaa0ed2dc9e0966d970986763979b8d1ac3cf978",
  "ccb.reference.communication-style": "b9c0137e1b814f3931a3fcb57ec334fcc7068badb89a3fe89efffb1e19e4d83f",
};

const EXPECTED_ORDER = [
  "ccb.reference.intro",
  "ccb.reference.system",
  "ccb.reference.doing-tasks",
  "ccb.reference.actions",
  "ccb.reference.using-tools",
  "ccb.reference.communication-style",
];

async function main() {
  // 1. 注册表包含全部参考段，且逐字快照一致。
  const registry = createDefaultPromptSectionRegistry();
  for (const sectionId of EXPECTED_ORDER) {
    const section = registry.resolve(sectionId, "1.0.0");
    const content = section.render();
    assert.equal(
      digestOf(content),
      EXPECTED_SECTION_DIGESTS[sectionId],
      `section ${sectionId} 与 CCB 原文快照不一致`,
    );
  }

  // 2-3. 按 ccb_main_reference Recipe 组装，校验顺序与内容。
  const builder = new SystemPromptBuilder({
    sections: registry,
    digester: new Sha256PromptDigester(),
    // 参考 Recipe 不包含 core.runtime.protocol / completion.contract，需显式放行。
    requiredSectionIds: [],
  });
  const compiled = await builder.build({
    definition: ccbMainReferenceAgentDefinition,
    capabilities: new PromptCapabilitySnapshot([]),
  });

  assert.deepEqual(
    compiled.blocks.map((block) => block.sourceId),
    EXPECTED_ORDER,
    "Recipe 段顺序应与 CCB 静态段顺序一致",
  );
  for (const block of compiled.blocks) {
    assert.ok(
      EXPECTED_SECTION_DIGESTS[block.sourceId],
      `unexpected block ${block.sourceId}`,
    );
  }

  // 4. 组装结果的关键标记。
  const content = compiled.content;
  assert.ok(content.includes("# System"), "缺少 System 段");
  assert.ok(content.includes("# Doing tasks"), "缺少 Doing tasks 段");
  assert.ok(content.includes("# Executing actions with care"), "缺少 Actions 段");
  assert.ok(content.includes("# Using your tools"), "缺少 Using your tools 段");
  assert.ok(
    content.includes("SearchExtraTools"),
    "System 段应包含 SearchExtraTools 说明",
  );

  console.log(
    `prompt-ccb-main-reference: ok (${compiled.blocks.length} blocks, ${content.length} chars)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
