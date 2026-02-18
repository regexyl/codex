import * as child_process from "node:child_process";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { AppServerClient } from "../src/appServerClient";

import { FakeChildProcess } from "./fakeChildProcess";

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

describe("AppServerClient", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("performs initialize handshake and handles method calls", async () => {
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
      if (message.method === "thread/list") {
        fakeProcess.emitStdoutMessage({
          id: message.id,
          result: { data: [], nextCursor: null },
        });
      }
    });
    spawnMock.mockReturnValue(fakeProcess as unknown as child_process.ChildProcess);

    const client = await AppServerClient.connect({
      codexPathOverride: "codex",
      initialize: {
        capabilities: { experimentalApi: true },
      },
    });

    const result = await client.call<{ data: unknown[]; nextCursor: string | null }>("thread/list", {
      cursor: null,
      limit: 5,
    });

    expect(result).toEqual({ data: [], nextCursor: null });
    expect(fakeProcess.sentMessages[0]).toMatchObject({ method: "initialize" });
    expect(fakeProcess.sentMessages[1]).toMatchObject({ method: "initialized" });

    await client.close();
  });

  it("streams server notifications", async () => {
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
    const iterator = client.notifications[Symbol.asyncIterator]();

    fakeProcess.emitStdoutMessage({
      method: "turn/completed",
      params: { turn: { id: "turn-1", status: "completed" } },
    });

    const received = await iterator.next();
    expect(received.done).toBe(false);
    expect(received.value).toEqual({
      method: "turn/completed",
      params: { turn: { id: "turn-1", status: "completed" } },
    });

    await client.close();
  });

  it("rejects calls on JSON-RPC errors", async () => {
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
      if (message.method === "thread/read") {
        fakeProcess.emitStdoutMessage({
          id: message.id,
          error: { code: 400, message: "bad request" },
        });
      }
    });
    spawnMock.mockReturnValue(fakeProcess as unknown as child_process.ChildProcess);

    const client = await AppServerClient.connect({ codexPathOverride: "codex" });
    await expect(client.call("thread/read", { threadId: "thread-1" })).rejects.toThrow(
      /JSON-RPC error 400: bad request/,
    );

    await client.close();
  });

  it("rejects pending calls when the process exits", async () => {
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
    const pending = client.call("thread/list", { cursor: null, limit: 10 });
    fakeProcess.emitExit(1, null);

    await expect(pending).rejects.toThrow(/exited with code 1|stream ended unexpectedly/);
  });
});
