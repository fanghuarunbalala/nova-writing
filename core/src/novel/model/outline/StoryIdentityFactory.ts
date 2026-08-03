/** Generates stable Story Outline and StoryUnit identities behind one port. */
import {
  captureStoryOutlineId,
  captureStoryEventStepId,
  captureStoryUnitId,
  type StoryEventStepId,
  type StoryOutlineId,
  type StoryUnitId,
} from "../../identity/index.js";

export interface StoryIdentityFactory {
  createStoryOutlineId(): StoryOutlineId;
  createStoryUnitId(): StoryUnitId;
  createStoryEventStepId(): StoryEventStepId;
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
}

function createRandomIdentity(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}
