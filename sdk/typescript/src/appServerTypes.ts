export type JsonRpcId = string | number;

export type JsonRpcRequest<Method extends string = string, Params = unknown> = {
  id: JsonRpcId;
  method: Method;
  params?: Params;
};

export type JsonRpcNotification<Method extends string = string, Params = unknown> = {
  method: Method;
  params?: Params;
};

export type JsonRpcResponse<Result = unknown> = {
  id: JsonRpcId;
  result: Result;
};

export type JsonRpcErrorPayload = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcError = {
  id: JsonRpcId;
  error: JsonRpcErrorPayload;
};

export type JsonRpcMessage =
  | JsonRpcRequest<string, unknown>
  | JsonRpcNotification<string, unknown>
  | JsonRpcResponse<unknown>
  | JsonRpcError;

export const APP_SERVER_CLIENT_METHODS = [
  "initialize",
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/archive",
  "thread/name/set",
  "thread/unarchive",
  "thread/compact/start",
  "thread/backgroundTerminals/clean",
  "thread/rollback",
  "thread/list",
  "thread/loaded/list",
  "thread/read",
  "skills/list",
  "skills/remote/list",
  "skills/remote/export",
  "app/list",
  "skills/config/write",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "review/start",
  "model/list",
  "experimentalFeature/list",
  "collaborationMode/list",
  "mcpServer/oauth/login",
  "config/mcpServer/reload",
  "mcpServerStatus/list",
  "account/login/start",
  "account/login/cancel",
  "account/logout",
  "account/rateLimits/read",
  "feedback/upload",
  "command/exec",
  "config/read",
  "config/value/write",
  "config/batchWrite",
  "configRequirements/read",
  "account/read",
  // Legacy methods supported by app-server for compatibility.
  "newConversation",
  "getConversationSummary",
  "listConversations",
  "resumeConversation",
  "forkConversation",
  "archiveConversation",
  "sendUserMessage",
  "sendUserTurn",
  "interruptConversation",
  "addConversationListener",
  "removeConversationListener",
  "gitDiffToRemote",
  "loginApiKey",
  "loginChatGpt",
  "cancelLoginChatGpt",
  "logoutChatGpt",
  "getAuthStatus",
  "getUserSavedConfig",
  "setDefaultModel",
  "getUserAgent",
  "userInfo",
  "fuzzyFileSearch",
  "fuzzyFileSearch/sessionStart",
  "fuzzyFileSearch/sessionUpdate",
  "fuzzyFileSearch/sessionStop",
  "execOneOffCommand",
] as const;

export type AppServerClientMethod = (typeof APP_SERVER_CLIENT_METHODS)[number];

export type InitializeParams = {
  clientInfo: {
    name: string;
    title?: string | null;
    version: string;
  };
  capabilities: {
    experimentalApi: boolean;
    optOutNotificationMethods?: string[] | null;
  } | null;
};

export type InitializeResponse = {
  userAgent: string;
};

export type CommandExecutionApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel"
  | { acceptWithExecpolicyAmendment: { execpolicy_amendment: unknown } };

export type FileChangeApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type CommandExecutionRequestApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  commandActions?: unknown[] | null;
  proposedExecpolicyAmendment?: unknown | null;
};

export type CommandExecutionRequestApprovalResponse = {
  decision: CommandExecutionApprovalDecision;
};

export type FileChangeRequestApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
};

export type FileChangeRequestApprovalResponse = {
  decision: FileChangeApprovalDecision;
};

export type ToolRequestUserInputParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: unknown[];
};

export type ToolRequestUserInputResponse = {
  answers: Record<string, { answers: string[] }>;
};

export type DynamicToolCallParams = {
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  arguments: unknown;
};

export type DynamicToolCallResponse = {
  contentItems: Array<{ type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string }>;
  success: boolean;
};

export type ChatgptAuthTokensRefreshParams = {
  reason: string;
  previousAccountId?: string | null;
};

export type ChatgptAuthTokensRefreshResponse = {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType: string | null;
};

export type AppServerServerRequestMethod =
  | "item/commandExecution/requestApproval"
  | "item/fileChange/requestApproval"
  | "item/tool/requestUserInput"
  | "item/tool/call"
  | "account/chatgptAuthTokens/refresh";

export type AppServerServerRequestHandlers = {
  onCommandExecutionRequestApproval?: (
    params: CommandExecutionRequestApprovalParams,
  ) =>
    | Promise<CommandExecutionRequestApprovalResponse | undefined>
    | CommandExecutionRequestApprovalResponse
    | undefined;
  onFileChangeRequestApproval?: (
    params: FileChangeRequestApprovalParams,
  ) => Promise<FileChangeRequestApprovalResponse | undefined> | FileChangeRequestApprovalResponse | undefined;
  onToolRequestUserInput?: (
    params: ToolRequestUserInputParams,
  ) => Promise<ToolRequestUserInputResponse | undefined> | ToolRequestUserInputResponse | undefined;
  onDynamicToolCall?: (
    params: DynamicToolCallParams,
  ) => Promise<DynamicToolCallResponse | undefined> | DynamicToolCallResponse | undefined;
  onChatgptAuthTokensRefresh?: (
    params: ChatgptAuthTokensRefreshParams,
  ) =>
    | Promise<ChatgptAuthTokensRefreshResponse | undefined>
    | ChatgptAuthTokensRefreshResponse
    | undefined;
  onUnhandledServerRequest?: (
    request: JsonRpcRequest<string, unknown>,
  ) => Promise<unknown | undefined> | unknown | undefined;
};

export type AppServerNotification = JsonRpcNotification<string, unknown>;
