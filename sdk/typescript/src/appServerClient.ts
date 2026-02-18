import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

import { resolveCodexBinaryPath } from "./codexBinary";
import { serializeConfigOverrides } from "./configOverrides";
import { AppServerOptions } from "./appServerOptions";
import {
  AppServerNotification,
  AppServerServerRequestHandlers,
  CommandExecutionRequestApprovalResponse,
  DynamicToolCallResponse,
  InitializeParams,
  InitializeResponse,
  JsonRpcError,
  JsonRpcErrorPayload,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  ToolRequestUserInputResponse,
  FileChangeRequestApprovalResponse,
} from "./appServerTypes";

const INTERNAL_ORIGINATOR_ENV = "CODEX_INTERNAL_ORIGINATOR_OVERRIDE";
const TYPESCRIPT_SDK_ORIGINATOR = "codex_sdk_ts";
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const JSON_RPC_METHOD_NOT_FOUND = -32601;

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | null;
};

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ done: false, value });
    } else {
      this.values.push(value);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          const value = this.values.shift();
          return Promise.resolve({ done: false, value: value as T });
        }
        if (this.closed) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}

export class AppServerClient {
  private readonly options: AppServerOptions;
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly stdoutReader: readline.Interface;
  private readonly notificationsQueue = new AsyncQueue<AppServerNotification>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly requestHandlers: AppServerServerRequestHandlers;
  private nextRequestId = 1;
  private initialized = false;
  private shuttingDown = false;
  private closed = false;
  private closeError: Error | null = null;
  private readonly readLoop: Promise<void>;

  static async connect(options: AppServerOptions = {}): Promise<AppServerClient> {
    const client = new AppServerClient(options);
    await client.initialize();
    return client;
  }

  private constructor(options: AppServerOptions) {
    this.options = options;
    this.requestHandlers = options.serverRequests ?? {};
    const executablePath = resolveCodexBinaryPath(options.codexPathOverride ?? null);
    const commandArgs = this.buildCommandArgs(options);

    this.process = spawn(executablePath, commandArgs, {
      env: this.buildEnv(options),
    });

    if (!this.process.stdin || !this.process.stdout) {
      this.process.kill();
      throw new Error("Failed to start codex app-server process");
    }

    this.process.once("error", (error) => {
      this.markClosed(asError(error, "Failed to spawn codex app-server process"));
    });

    this.process.once("exit", (code, signal) => {
      if (this.closed) {
        return;
      }
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      this.markClosed(new Error(`codex app-server exited with ${detail}`));
    });

    this.stdoutReader = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });
    this.readLoop = this.consumeStdout();
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get notifications(): AsyncIterable<AppServerNotification> {
    return this.notificationsQueue;
  }

  async call<Result = unknown, Params = unknown>(
    method: string,
    params?: Params,
    requestTimeoutMs?: number,
  ): Promise<Result> {
    if (!this.initialized && method !== "initialize") {
      throw new Error("AppServerClient is not initialized");
    }
    if (this.closed) {
      throw this.closeError ?? new Error("AppServerClient is closed");
    }

    const id: JsonRpcId = this.nextRequestId++;
    const idKey = requestIdKey(id);
    const timeoutMs = this.resolveRequestTimeoutMs(requestTimeoutMs);
    const request: JsonRpcRequest<string, Params> =
      params === undefined ? { id, method } : { id, method, params };

    const result = new Promise<Result>((resolve, reject) => {
      const timeout =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pendingRequests.delete(idKey);
              reject(new Error(`JSON-RPC request timed out: ${method}`));
            }, timeoutMs)
          : null;

      this.pendingRequests.set(idKey, {
        resolve: (value) => resolve(value as Result),
        reject,
        timeout,
      });
    });

    try {
      await this.sendMessage(request);
    } catch (error) {
      const pending = this.pendingRequests.get(idKey);
      this.pendingRequests.delete(idKey);
      if (pending?.timeout) {
        clearTimeout(pending.timeout);
      }
      throw asError(error, `Failed to send JSON-RPC request: ${method}`);
    }

    return result;
  }

  async close(): Promise<void> {
    if (this.shuttingDown || this.closed) {
      await this.readLoop.catch(() => {});
      return;
    }
    this.shuttingDown = true;

    try {
      if (!this.process.killed) {
        this.process.kill();
      }
    } catch {
      // Ignore kill errors.
    }

    await this.readLoop.catch(() => {});
  }

  private async initialize(): Promise<void> {
    const initializeParams = this.buildInitializeParams();
    await this.call<InitializeResponse, InitializeParams>("initialize", initializeParams);
    await this.sendNotification("initialized");
    this.initialized = true;
  }

  private buildCommandArgs(options: AppServerOptions): string[] {
    const args: string[] = ["app-server"];
    if (options.config) {
      for (const override of serializeConfigOverrides(options.config)) {
        args.push("--config", override);
      }
    }
    if (options.appServerArgs?.length) {
      args.push(...options.appServerArgs);
    }
    return args;
  }

  private buildEnv(options: AppServerOptions): Record<string, string> {
    const env: Record<string, string> = {};
    if (options.env) {
      Object.assign(env, options.env);
    } else {
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }
    }

    if (!env[INTERNAL_ORIGINATOR_ENV]) {
      env[INTERNAL_ORIGINATOR_ENV] = TYPESCRIPT_SDK_ORIGINATOR;
    }
    if (options.baseUrl) {
      env.OPENAI_BASE_URL = options.baseUrl;
    }
    if (options.apiKey) {
      env.CODEX_API_KEY = options.apiKey;
    }

    return env;
  }

  private buildInitializeParams(): InitializeParams {
    const capabilities = this.options.initialize?.capabilities;
    return {
      clientInfo: {
        name: this.options.initialize?.clientInfo?.name ?? "codex_sdk_ts",
        title: this.options.initialize?.clientInfo?.title ?? "Codex TypeScript SDK",
        version: this.options.initialize?.clientInfo?.version ?? "0.0.0",
      },
      capabilities: capabilities
        ? {
            experimentalApi: capabilities.experimentalApi ?? false,
            optOutNotificationMethods: capabilities.optOutNotificationMethods ?? null,
          }
        : null,
    };
  }

  private resolveRequestTimeoutMs(requestTimeoutMs: number | undefined): number {
    if (requestTimeoutMs !== undefined) {
      return Math.max(0, requestTimeoutMs);
    }
    if (this.options.requestTimeoutMs !== undefined) {
      return Math.max(0, this.options.requestTimeoutMs);
    }
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private async consumeStdout(): Promise<void> {
    try {
      for await (const rawLine of this.stdoutReader) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        let message: JsonRpcMessage;
        try {
          message = JSON.parse(line) as JsonRpcMessage;
        } catch {
          continue;
        }
        await this.handleMessage(message);
      }
      if (!this.closed) {
        this.markClosed(new Error("codex app-server stream ended unexpectedly"));
      }
    } catch (error) {
      this.markClosed(asError(error, "Failed while reading codex app-server output"));
    } finally {
      this.stdoutReader.close();
    }
  }

  private async handleMessage(message: JsonRpcMessage): Promise<void> {
    if (isJsonRpcResponse(message)) {
      this.resolvePending(message.id, message.result);
      return;
    }

    if (isJsonRpcError(message)) {
      this.rejectPending(message.id, message.error);
      return;
    }

    if (isJsonRpcRequest(message)) {
      await this.handleServerRequest(message);
      return;
    }

    if (isJsonRpcNotification(message)) {
      this.notificationsQueue.push(message);
    }
  }

  private async handleServerRequest(request: JsonRpcRequest<string, unknown>): Promise<void> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case "item/commandExecution/requestApproval": {
          const response =
            (await this.requestHandlers.onCommandExecutionRequestApproval?.(
              params as Parameters<
                NonNullable<AppServerServerRequestHandlers["onCommandExecutionRequestApproval"]>
              >[0],
            )) ?? defaultCommandExecutionApprovalResponse();
          await this.sendResponse(id, response);
          return;
        }

        case "item/fileChange/requestApproval": {
          const response =
            (await this.requestHandlers.onFileChangeRequestApproval?.(
              params as Parameters<
                NonNullable<AppServerServerRequestHandlers["onFileChangeRequestApproval"]>
              >[0],
            )) ?? defaultFileChangeApprovalResponse();
          await this.sendResponse(id, response);
          return;
        }

        case "item/tool/requestUserInput": {
          const response =
            (await this.requestHandlers.onToolRequestUserInput?.(
              params as Parameters<
                NonNullable<AppServerServerRequestHandlers["onToolRequestUserInput"]>
              >[0],
            )) ?? defaultRequestUserInputResponse();
          await this.sendResponse(id, response);
          return;
        }

        case "item/tool/call": {
          const response =
            (await this.requestHandlers.onDynamicToolCall?.(
              params as Parameters<NonNullable<AppServerServerRequestHandlers["onDynamicToolCall"]>>[0],
            )) ?? defaultDynamicToolCallResponse();
          await this.sendResponse(id, response);
          return;
        }

        case "account/chatgptAuthTokens/refresh": {
          const response = await this.requestHandlers.onChatgptAuthTokensRefresh?.(
            params as Parameters<
              NonNullable<AppServerServerRequestHandlers["onChatgptAuthTokensRefresh"]>
            >[0],
          );
          if (!response) {
            await this.sendError(
              id,
              JSON_RPC_METHOD_NOT_FOUND,
              "Missing onChatgptAuthTokensRefresh handler",
            );
            return;
          }
          await this.sendResponse(id, response);
          return;
        }

        default: {
          const response = await this.requestHandlers.onUnhandledServerRequest?.(request);
          if (response !== undefined) {
            await this.sendResponse(id, response);
            return;
          }
          await this.sendError(
            id,
            JSON_RPC_METHOD_NOT_FOUND,
            `Unhandled server request method: ${method}`,
          );
        }
      }
    } catch (error) {
      const message = asError(error, `Failed to handle server request: ${method}`).message;
      await this.sendError(id, -32000, message);
    }
  }

  private async sendNotification(method: string, params?: unknown): Promise<void> {
    const notification: JsonRpcNotification<string, unknown> =
      params === undefined ? { method } : { method, params };
    await this.sendMessage(notification);
  }

  private async sendResponse(id: JsonRpcId, result: unknown): Promise<void> {
    const response: JsonRpcResponse<unknown> = { id, result };
    await this.sendMessage(response);
  }

  private async sendError(id: JsonRpcId, code: number, message: string, data?: unknown): Promise<void> {
    const error: JsonRpcError = {
      id,
      error: {
        code,
        message,
        data,
      },
    };
    await this.sendMessage(error);
  }

  private async sendMessage(message: JsonRpcMessage): Promise<void> {
    if (this.closed) {
      throw this.closeError ?? new Error("AppServerClient is closed");
    }

    const encoded = `${JSON.stringify(message)}\n`;
    await new Promise<void>((resolve, reject) => {
      this.process.stdin.write(encoded, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private resolvePending(id: JsonRpcId, result: unknown): void {
    const key = requestIdKey(id);
    const pending = this.pendingRequests.get(key);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(key);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    pending.resolve(result);
  }

  private rejectPending(id: JsonRpcId, payload: JsonRpcErrorPayload): void {
    const key = requestIdKey(id);
    const pending = this.pendingRequests.get(key);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(key);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    const error = new Error(`JSON-RPC error ${payload.code}: ${payload.message}`);
    (error as Error & { data?: unknown }).data = payload.data;
    pending.reject(error);
  }

  private markClosed(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeError = error;
    this.notificationsQueue.close();

    for (const pending of this.pendingRequests.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
    this.pendingRequests.clear();

    try {
      if (!this.process.killed) {
        this.process.kill();
      }
    } catch {
      // Ignore process kill failures while closing.
    }
  }
}

function defaultCommandExecutionApprovalResponse(): CommandExecutionRequestApprovalResponse {
  return { decision: "decline" };
}

function defaultFileChangeApprovalResponse(): FileChangeRequestApprovalResponse {
  return { decision: "decline" };
}

function defaultRequestUserInputResponse(): ToolRequestUserInputResponse {
  return { answers: {} };
}

function defaultDynamicToolCallResponse(): DynamicToolCallResponse {
  return { contentItems: [], success: false };
}

function isJsonRpcNotification(value: unknown): value is JsonRpcNotification<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.method === "string" &&
    !Object.prototype.hasOwnProperty.call(value, "id")
  );
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.method === "string" &&
    isJsonRpcId((value as { id?: unknown }).id)
  );
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse<unknown> {
  return (
    isRecord(value) &&
    isJsonRpcId((value as { id?: unknown }).id) &&
    Object.prototype.hasOwnProperty.call(value, "result")
  );
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  if (!isRecord(value) || !isJsonRpcId((value as { id?: unknown }).id)) {
    return false;
  }
  const error = (value as { error?: unknown }).error;
  return (
    isRecord(error) &&
    typeof (error as { code?: unknown }).code === "number" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

function requestIdKey(id: JsonRpcId): string {
  return typeof id === "number" ? `n:${id}` : `s:${id}`;
}

function asError(value: unknown, fallbackMessage: string): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(fallbackMessage);
}
