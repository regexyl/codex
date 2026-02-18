#!/usr/bin/env -S NODE_NO_WARNINGS=1 pnpm ts-node-esm --files

import { Effect } from "effect";

import { CodexEffect } from "@openai/codex-sdk";
import { codexPathOverride } from "./helpers.ts";

type ThreadStartResult = {
  thread: { id: string };
};

type TurnStartResult = {
  turn: { id: string; status: string };
};

type McpStatusListResult = {
  data: Array<{ name: string; authStatus: string }>;
  nextCursor: string | null;
};

const program = Effect.scoped(
  Effect.gen(function* () {
    const appServer = yield* CodexEffect.appServer.scoped({
      codexPathOverride: codexPathOverride(),
      initialize: {
        clientInfo: {
          name: "codex_sdk_ts_sample",
          title: "CodexEffect Sample (MCP)",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      },
    });
    const cli = yield* CodexEffect.cli.scoped({
      codexPathOverride: codexPathOverride(),
    });

    // Replace this with your own MCP command, for example:
    // codex mcp add docs --url http://127.0.0.1:8080/mcp
    const mcpList = yield* CodexEffect.cli.run(cli, {
      args: ["mcp", "list", "--json"],
      throwOnNonZero: true,
    });
    console.log(`Configured MCP servers: ${mcpList.stdout}`);

    // Reload app-server MCP config after changing mcp servers via CLI.
    yield* CodexEffect.appServer.call(appServer, "config/mcpServer/reload");

    const statuses = yield* CodexEffect.appServer.call<McpStatusListResult>(
      appServer,
      "mcpServerStatus/list",
      { cursor: null, limit: 100 },
    );
    console.log(
      "MCP status snapshot:",
      statuses.data.map((entry) => `${entry.name}:${entry.authStatus}`),
    );

    const start = yield* CodexEffect.appServer.call<ThreadStartResult>(appServer, "thread/start", {
      model: "gpt-5.1-codex",
      approvalPolicy: "never",
      sandbox: "workspaceWrite",
      cwd: process.cwd(),
    });

    const turn = yield* CodexEffect.appServer.call<TurnStartResult>(appServer, "turn/start", {
      threadId: start.thread.id,
      input: [
        {
          type: "text",
          text: "Use any configured MCP tools to gather context, then summarize findings.",
          text_elements: [],
        },
      ],
    });
    console.log(`Started MCP-assisted turn: ${turn.turn.id}`);
  }),
);

Effect.runPromise(program).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
