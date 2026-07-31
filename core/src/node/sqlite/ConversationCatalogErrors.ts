export class ConversationAlreadyExistsError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Conversation already exists: ${conversationId}`);
    this.name = "ConversationAlreadyExistsError";
  }
}

export class ConversationParentNotFoundError extends Error {
  constructor(public readonly parentConversationId: string) {
    super(`Parent conversation not found: ${parentConversationId}`);
    this.name = "ConversationParentNotFoundError";
  }
}

export class ConversationWorkspaceMismatchError extends Error {
  constructor(
    public readonly conversationId: string,
    public readonly expectedWorkspaceId: string,
    public readonly actualWorkspaceId: string,
  ) {
    super(
      `Conversation ${conversationId} belongs to workspace ${actualWorkspaceId}, expected ${expectedWorkspaceId}`,
    );
    this.name = "ConversationWorkspaceMismatchError";
  }
}

export class ConversationAgentBindingMissingError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Conversation has no active agent binding: ${conversationId}`);
    this.name = "ConversationAgentBindingMissingError";
  }
}

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
