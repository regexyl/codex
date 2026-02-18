import * as child_process from "node:child_process";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { AppServerClient } from "../src/appServerClient";

import { FakeChildProcess, flushAsyncEvents } from "./fakeChildProcess";

jest.mock("node:child_process", () => {
  const actual = jest.requireActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: jest.fn() };
});

const _actualChildProcess =
  jest.requireActual<typeof import("node:child_process")>("node:child_process");
const spawnMock = child_process.spawn as jest.MockedFunction<typeof _actualChildProcess.spawn>;

type JsonRpcRequestMessage = { id: string | number; method: string; params?: unknown };

function isJsonRpcRequestMessage(message: unknown): message is JsonRpcRequestMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    typeof (message as { method?: unknown }).method === "string" &&
    (typeof (message as { id?: unknown }).id === "number" ||
      typeof (message as { id?: unknown }).id === "string")
  );
}

describe("AppServerClient server request handlers", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("uses safe default responses for server requests", async () => {
    const fakeProcess = new FakeChildProcess(async (message) => {
      if (!isJsonRpcRequestMessage(message)) {
        return;
      }
      if (message.method === "initialize") {
        fakeProcess.emitStdoutMessage({
          id: message.id,
          result: { userAgent: "codex-test" },
        });
      }
    });
    spawnMock.mockReturnValue(fakeProcess as unknown as child_process.ChildProcess);

    const client = await AppServerClient.connect({ codexPathOverride: "codex" });

    fakeProcess.emitStdoutMessage({
      id: 101,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "t", turnId: "u", itemId: "i" },
    });
    fakeProcess.emitStdoutMessage({
      id: 102,
      method: "item/fileChange/requestApproval",
      params: { threadId: "t", turnId: "u", itemId: "i" },
    });
    fakeProcess.emitStdoutMessage({
      id: 103,
      method: "item/tool/requestUserInput",
      params: { threadId: "t", turnId: "u", itemId: "i", questions: [] },
    });
    fakeProcess.emitStdoutMessage({
      id: 104,
      method: "item/tool/call",
      params: { threadId: "t", turnId: "u", callId: "c", tool: "demo", arguments: {} },
    });

    await flushAsyncEvents();
    await flushAsyncEvents();

    expect(fakeProcess.sentMessages).toContainEqual({ id: 101, result: { decision: "decline" } });
    expect(fakeProcess.sentMessages).toContainEqual({ id: 102, result: { decision: "decline" } });
    expect(fakeProcess.sentMessages).toContainEqual({ id: 103, result: { answers: {} } });
    expect(fakeProcess.sentMessages).toContainEqual({
      id: 104,
      result: { contentItems: [], success: false },
    });

    await client.close();
  });

  it("routes to custom request handlers when provided", async () => {
    const fakeProcess = new FakeChildProcess(async (message) => {
      if (!isJsonRpcRequestMessage(message)) {
        return;
      }
      if (message.method === "initialize") {
        fakeProcess.emitStdoutMessage({
          id: message.id,
          result: { userAgent: "codex-test" },
        });
      }
    });
    spawnMock.mockReturnValue(fakeProcess as unknown as child_process.ChildProcess);

    const client = await AppServerClient.connect({
      codexPathOverride: "codex",
      serverRequests: {
        onCommandExecutionRequestApproval: () => ({ decision: "accept" }),
        onChatgptAuthTokensRefresh: () => ({
          accessToken: "access-token",
          chatgptAccountId: "org-123",
          chatgptPlanType: "pro",
        }),
      },
    });

    fakeProcess.emitStdoutMessage({
      id: 201,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "t", turnId: "u", itemId: "i" },
    });
    fakeProcess.emitStdoutMessage({
      id: 202,
      method: "account/chatgptAuthTokens/refresh",
      params: { reason: "unauthorized", previousAccountId: null },
    });

    await flushAsyncEvents();
    await flushAsyncEvents();

    expect(fakeProcess.sentMessages).toContainEqual({ id: 201, result: { decision: "accept" } });
    expect(fakeProcess.sentMessages).toContainEqual({
      id: 202,
      result: {
        accessToken: "access-token",
        chatgptAccountId: "org-123",
        chatgptPlanType: "pro",
      },
    });

    await client.close();
  });

  it("returns method-not-found when auth token refresh handler is missing", async () => {
    const fakeProcess = new FakeChildProcess(async (message) => {
      if (!isJsonRpcRequestMessage(message)) {
        return;
      }
      if (message.method === "initialize") {
        fakeProcess.emitStdoutMessage({
          id: message.id,
          result: { userAgent: "codex-test" },
        });
      }
    });
    spawnMock.mockReturnValue(fakeProcess as unknown as child_process.ChildProcess);

    const client = await AppServerClient.connect({ codexPathOverride: "codex" });
    fakeProcess.emitStdoutMessage({
      id: 301,
      method: "account/chatgptAuthTokens/refresh",
      params: { reason: "unauthorized", previousAccountId: null },
    });

    await flushAsyncEvents();
    await flushAsyncEvents();

    expect(fakeProcess.sentMessages).toContainEqual({
      id: 301,
      error: {
        code: -32601,
        message: "Missing onChatgptAuthTokensRefresh handler",
      },
    });

    await client.close();
  });
});
