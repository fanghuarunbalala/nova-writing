/**
 * conversation projection 纯函数测试。
 */
import { describe, expect, it } from "vitest";
import {
  appendAssistantDraftDelta,
  assistantDraftText,
  cancelAssistantDraft,
  completeAssistantDraft,
  createAssistantDraftProjection,
  failAssistantDraft,
} from "../../../src/domains/conversation/projection/AssistantDraftProjection.js";
import { ConversationTimelineProjection } from "../../../src/domains/conversation/projection/ConversationTimelineProjection.js";

describe("AssistantDraftProjection", () => {
  it("accumulates deltas while streaming", () => {
    let projection = createAssistantDraftProjection(3);
    projection = appendAssistantDraftDelta(projection, "雨");
    projection = appendAssistantDraftDelta(projection, "很大");
    expect(projection.phase).toBe("streaming");
    expect(assistantDraftText(projection)).toBe("雨很大");
  });

  it("uses the terminal text once completed", () => {
    let projection = createAssistantDraftProjection(3);
    projection = appendAssistantDraftDelta(projection, "雨");
    projection = completeAssistantDraft(projection, "雨落得密");
    expect(projection.phase).toBe("completed");
    expect(assistantDraftText(projection)).toBe("雨落得密");
  });

  it("rejects deltas after terminal and tracks failed/cancelled phases", () => {
    let projection = createAssistantDraftProjection(1);
    projection = completeAssistantDraft(projection, "完成");
    expect(() => appendAssistantDraftDelta(projection, "x")).toThrow();
    expect(failAssistantDraft(projection).phase).toBe("failed");
    expect(cancelAssistantDraft(projection).phase).toBe("cancelled");
  });
});

describe("ConversationTimelineProjection", () => {
  it("builds user, system and assistant items", () => {
    const user = ConversationTimelineProjection.buildUserItem(1, "改雨", 100);
    expect(user.kind).toBe("user");
    const system = ConversationTimelineProjection.buildSystemItem(2, "已提交 r042", 200);
    expect(system.kind).toBe("system");
    const draft = completeAssistantDraft(createAssistantDraftProjection(3), "雨落得密");
    const assistant = ConversationTimelineProjection.buildAssistantItem(draft, {
      agentLabel: "Novel Agent",
      timestamp: 300,
    });
    expect(assistant.kind).toBe("assistant");
    if (assistant.kind === "assistant") {
      expect(assistant.text).toBe("雨落得密");
      expect(assistant.streaming).toBe(false);
      expect(assistant.approvalState).toBe("completed");
    }
  });

  it("marks streaming items while the draft is open", () => {
    const assistant = ConversationTimelineProjection.buildAssistantItem(
      createAssistantDraftProjection(3),
      { agentLabel: "Novel Agent", timestamp: 1 },
    );
    if (assistant.kind === "assistant") {
      expect(assistant.streaming).toBe(true);
    }
  });
});
