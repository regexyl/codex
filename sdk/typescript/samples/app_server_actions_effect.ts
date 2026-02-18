#!/usr/bin/env -S NODE_NO_WARNINGS=1 pnpm ts-node-esm --files

import { Effect, Stream } from "effect";

import { CodexEffect } from "@openai/codex-sdk";
import type { AppServerNotification } from "@openai/codex-sdk";

import { codexPathOverride } from "./helpers.ts";

type ThreadStartResult = {
  thread: { id: string };
};

type TurnStartResult = {
  turn: { id: string; status: string };
};

const program = Effect.scoped(
  Effect.gen(function* () {
    const client = yield* CodexEffect.appServer.scoped({
      codexPathOverride: codexPathOverride(),
      initialize: {
        clientInfo: {
          name: "codex_sdk_ts_sample",
          title: "CodexEffect Sample (No MCP)",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      },
    });

    const account = yield* CodexEffect.appServer.call<{
      account: unknown | null;
      requiresOpenaiAuth: boolean;
    }>(client, "account/read", { refreshToken: false });

    if (account.requiresOpenaiAuth && !account.account) {
      throw new Error("Not authenticated. Run `codex login` first.");
    }

    const start = yield* CodexEffect.appServer.call<ThreadStartResult>(client, "thread/start", {
      model: "gpt-5.1-codex",
      approvalPolicy: "never",
      sandbox: "workspaceWrite",
      cwd: process.cwd(),
    });
    console.log(`Started thread: ${start.thread.id}`);

    const turn = yield* CodexEffect.appServer.call<TurnStartResult>(client, "turn/start", {
      threadId: start.thread.id,
      input: [
        {
          type: "text",
          text: "Summarize this repository and suggest three high-impact improvements.",
          text_elements: [],
        },
      ],
    });
    console.log(`Started turn: ${turn.turn.id}`);

    yield* Stream.runForEach(
      CodexEffect.appServer.notifications(client).pipe(Stream.take(40)),
      (event: AppServerNotification) =>
        Effect.sync(() => {
          if (event.method === "item/agentMessage/delta") {
            const delta = (event.params as { delta?: string } | undefined)?.delta;
            if (delta) {
              process.stdout.write(delta);
            }
          }
          if (
            event.method === "turn/completed" &&
            (event.params as { turn?: { id?: string; status?: string } } | undefined)?.turn?.id ===
              turn.turn.id
          ) {
            const status = (event.params as { turn?: { status?: string } } | undefined)?.turn?.status;
            console.log(`\nTurn completed with status: ${status ?? "unknown"}`);
          }
        }),
    );
  }),
);

Effect.runPromise(program).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
