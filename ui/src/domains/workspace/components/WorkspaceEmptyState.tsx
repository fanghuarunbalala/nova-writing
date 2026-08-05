/** Chat-first empty state prompting the first Workspace selection. */
export interface WorkspaceEmptyStateProps {
  readonly onSelectWorkspace: () => void;
}

export function WorkspaceEmptyState({
  onSelectWorkspace,
}: WorkspaceEmptyStateProps) {
  return (
    <div className="novel-workspace-empty-state">
      <span>开始创作</span>
      <h1>选择你的小说项目</h1>
      <p>打开一个 Workspace 后，可以创建对话并开始组织大纲、人物和正文。</p>
      <button className="novel-primary-action" onClick={onSelectWorkspace} type="button">
        选择 Workspace
      </button>
    </div>
  );
}
