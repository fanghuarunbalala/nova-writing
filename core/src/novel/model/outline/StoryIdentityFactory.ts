/** Generates stable Story Outline and StoryUnit identities behind one port. */
import {
  captureStoryOutlineId,
  captureStoryEventStepId,
  captureRhythmBeatId,
  captureStoryUnitId,
  type StoryEventStepId,
  type RhythmBeatId,
  type StoryOutlineId,
  type StoryUnitId,
} from "../../identity/index.js";

export interface StoryIdentityFactory {
  createStoryOutlineId(): StoryOutlineId;
  createStoryUnitId(): StoryUnitId;
  createStoryEventStepId(): StoryEventStepId;
  createRhythmBeatId(): RhythmBeatId;
}

export class RandomStoryIdentityFactory implements StoryIdentityFactory {
  createStoryOutlineId(): StoryOutlineId {
    return captureStoryOutlineId(createRandomIdentity("outline"));
  }

  createStoryUnitId(): StoryUnitId {
    return captureStoryUnitId(createRandomIdentity("story_unit"));
  }

  createStoryEventStepId(): StoryEventStepId {
    return captureStoryEventStepId(createRandomIdentity("story_event"));
  }

  createRhythmBeatId(): RhythmBeatId {
    return captureRhythmBeatId(createRandomIdentity("rhythm_beat"));
  }
}

function createRandomIdentity(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}
