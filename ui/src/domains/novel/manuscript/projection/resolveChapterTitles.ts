/**
 * resolveChapterTitles
 *
 * 把大纲树中的 story unit 标题注入手稿章节卡。
 * ManuscriptStructureStore 按 storyUnitId 分组产出章节（title 为 storyUnitId
 * 占位），本投影用大纲树的 unit label 覆盖 title，使正文视图显示真实章节名；
 * 大纲树查不到的章节（如未归属回退组、或大纲未加载）保持原 title 不变。
 */
import type { StoryOutlineTreeNode } from "../../outline/projection/StoryOutlineTreeProjection.js";
import type { ManuscriptChapter } from "../store/ManuscriptStructureStore.js";

export function resolveChapterTitles(
  chapters: readonly ManuscriptChapter[],
  outlineRoots: readonly StoryOutlineTreeNode[],
): readonly ManuscriptChapter[] {
  const titleByUnitId = new Map<string, string>();
  const visit = (node: StoryOutlineTreeNode): void => {
    titleByUnitId.set(node.unitId, node.label);
    for (const child of node.children) visit(child);
  };
  for (const node of outlineRoots) visit(node);
  if (titleByUnitId.size === 0) return chapters;
  return chapters.map((chapter) => {
    const title = titleByUnitId.get(chapter.chapterId);
    if (title === undefined) return chapter;
    return Object.freeze({ ...chapter, title });
  });
}
