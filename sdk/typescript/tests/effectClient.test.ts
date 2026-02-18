import { Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { AppServerClient } from "../src/appServerClient";
import { CliActionRunner } from "../src/cliActionRunner";
import { CodexEffect } from "../src/effectClient";

describe("CodexEffect", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("wraps app-server scoped lifecycle and method calls", async () => {
    const call = jest.fn(async () => ({ data: [], nextCursor: null }));
    const close = jest.fn(async () => undefined);
    const notifications = (async function* () {
      yield { method: "thread/started", params: { thread: { id: "thread-1" } } };
    })();

    const fakeClient = {
      call,
      close,
      notifications,
    } as unknown as AppServerClient;

    jest.spyOn(AppServerClient, "connect").mockResolvedValue(fakeClient);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* CodexEffect.appServer.scoped({ codexPathOverride: "codex" });
          return yield* CodexEffect.appServer.call<{ data: unknown[]; nextCursor: string | null }>(
            client,
            "thread/list",
            { cursor: null, limit: 10 },
          );
        }),
      ),
    );

    expect(result).toEqual({ data: [], nextCursor: null });
    expect(call).toHaveBeenCalledWith("thread/list", { cursor: null, limit: 10 }, undefined);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("adapts app-server notifications into an Effect stream", async () => {
    const fakeClient = {
      notifications: (async function* () {
        yield { method: "turn/completed", params: { turn: { id: "turn-1" } } };
      })(),
    } as unknown as AppServerClient;

    const seen: unknown[] = [];
    await Effect.runPromise(
      Stream.runForEach(
        CodexEffect.appServer.notifications(fakeClient).pipe(Stream.take(1)),
        (event) =>
          Effect.sync(() => {
            seen.push(event);
          }),
      ),
    );

    expect(seen).toEqual([{ method: "turn/completed", params: { turn: { id: "turn-1" } } }]);
  });

  it("wraps CLI runner operations as Effects", async () => {
    const fakeRunner = {
      run: jest.fn(async () => ({
        args: ["features", "list"],
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        signal: null,
      })),
    } as unknown as CliActionRunner;

    const result = await Effect.runPromise(
      CodexEffect.cli.run(fakeRunner, {
        args: ["features", "list"],
      }),
    );

    expect(result).toEqual({
      args: ["features", "list"],
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });
});
