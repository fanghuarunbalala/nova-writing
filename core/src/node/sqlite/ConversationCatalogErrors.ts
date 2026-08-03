export {
  ConversationAgentBindingMissingError,
  ConversationAlreadyExistsError,
  ConversationParentNotFoundError,
  ConversationWorkspaceMismatchError,
} from "../../storage/index.js";

export class WorkspaceDatabaseMismatchError extends Error {
  constructor(
    public readonly databasePath: string,
    public readonly expectedWorkspaceId: string,
    public readonly actualWorkspaceId: string,
  ) {
    super(
      `Database ${databasePath} belongs to workspace ${actualWorkspaceId}, expected ${expectedWorkspaceId}`,
    );
    this.name = "WorkspaceDatabaseMismatchError";
  }
}
