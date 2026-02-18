# Codex SDK

Embed the Codex agent in your workflows and apps.

The TypeScript SDK wraps the `codex` CLI from `@openai/codex`. It spawns the CLI and exchanges JSONL events over stdin/stdout.

## Installation

```bash
npm install @openai/codex-sdk
```

Requires Node.js 18+.

## Quickstart

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();
const thread = codex.startThread();
const turn = await thread.run("Diagnose the test failure and propose a fix");

console.log(turn.finalResponse);
console.log(turn.items);
```

Call `run()` repeatedly on the same `Thread` instance to continue that conversation.

```typescript
const nextTurn = await thread.run("Implement the fix");
```

## Choose your API

The SDK now exposes two complementary APIs:

1. `Codex` / `Thread` (high-level): best for straightforward prompt/turn workflows.
2. `CodexEffect` (low-level control plane): best for full action coverage, orchestration, and Effect-based runtime composition.

Use `CodexEffect` when you need to call the full `codex app-server` JSON-RPC surface (threads, turns, review, account, config, MCP status, etc.) or when you want to invoke arbitrary CLI subcommands programmatically.

## ChatGPT subscription flow

If your goal is to use your ChatGPT subscription (instead of API-key billing), authenticate once with:

```bash
codex login
```

After that, `CodexEffect.appServer` calls can use your existing session.

## CodexEffect quickstart (no MCP)

```typescript
import { Effect, Stream } from "effect";
import { CodexEffect } from "@openai/codex-sdk";

const program = Effect.scoped(
  Effect.gen(function* () {
    const client = yield* CodexEffect.appServer.scoped({
      initialize: {
        clientInfo: {
          name: "my_orchestrator",
          title: "My Orchestrator",
          version: "0.1.0",
        },
      },
    });

    const start = yield* CodexEffect.appServer.call<{ thread: { id: string } }>(
      client,
      "thread/start",
      {
        model: "gpt-5.1-codex",
        approvalPolicy: "never",
        sandbox: "workspaceWrite",
        cwd: process.cwd(),
      },
    );

    const turn = yield* CodexEffect.appServer.call<{ turn: { id: string } }>(
      client,
      "turn/start",
      {
        threadId: start.thread.id,
        input: [
          {
            type: "text",
            text: "Summarize this repository and propose three improvements.",
            text_elements: [],
          },
        ],
      },
    );

    yield* Stream.runForEach(
      CodexEffect.appServer.notifications(client).pipe(Stream.take(40)),
      (event) =>
        Effect.sync(() => {
          if (event.method === "item/agentMessage/delta") {
            const delta = (event.params as { delta?: string } | undefined)?.delta;
            if (delta) process.stdout.write(delta);
          }
          if (
            event.method === "turn/completed" &&
            (event.params as { turn?: { id?: string } } | undefined)?.turn?.id === turn.turn.id
          ) {
            process.stdout.write("\n");
          }
        }),
    );
  }),
);

await Effect.runPromise(program);
```

## CodexEffect quickstart (with MCP)

```typescript
import { Effect } from "effect";
import { CodexEffect } from "@openai/codex-sdk";

const program = Effect.scoped(
  Effect.gen(function* () {
    const appServer = yield* CodexEffect.appServer.scoped();
    const cli = yield* CodexEffect.cli.scoped();

    // Example: inspect configured MCP servers via CLI.
    const list = yield* CodexEffect.cli.run(cli, {
      args: ["mcp", "list", "--json"],
      throwOnNonZero: true,
    });
    console.log(list.stdout);

    // If you changed MCP config through CLI, reload app-server view.
    yield* CodexEffect.appServer.call(appServer, "config/mcpServer/reload");

    const statuses = yield* CodexEffect.appServer.call<{
      data: Array<{ name: string; authStatus: string }>;
      nextCursor: string | null;
    }>(appServer, "mcpServerStatus/list", { cursor: null, limit: 100 });

    console.log(statuses.data.map((x) => `${x.name}:${x.authStatus}`));
  }),
);

await Effect.runPromise(program);
```

## Run any CLI action programmatically

`CodexEffect.cli` is a generic subprocess wrapper over `codex` itself, so you can call non-app-server subcommands too:

```typescript
import { Effect } from "effect";
import { CodexEffect } from "@openai/codex-sdk";

const output = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const cli = yield* CodexEffect.cli.scoped();
      return yield* CodexEffect.cli.run(cli, {
        args: ["features", "list"],
        throwOnNonZero: true,
      });
    }),
  ),
);

console.log(output.stdout);
```

## Orchestration patterns

For agent-team style orchestration, design your runtime around:

1. A host-side scheduler (DAG/task graph), not only prompt-driven delegation.
2. Profile-driven sub-agent defaults (`pm`, `engineer`, `designer`, `qa`) mapped to model/reasoning/sandbox policy.
3. Typed inter-agent messages (`task`, `question`, `artifact`, `status`) routed through a central orchestrator bus.
4. Adaptive concurrency (respect `agents.max_threads`, rate limits, and critical path).
5. Event-driven waiting via streams/notifications (avoid busy polling loops).

`CodexEffect.appServer` gives you the control plane APIs; `CodexEffect.cli` lets you still invoke CLI-only surfaces when needed.

### Streaming responses

`run()` buffers events until the turn finishes. To react to intermediate progress—tool calls, streaming responses, and file change notifications—use `runStreamed()` instead, which returns an async generator of structured events.

```typescript
const { events } = await thread.runStreamed("Diagnose the test failure and propose a fix");

for await (const event of events) {
  switch (event.type) {
    case "item.completed":
      console.log("item", event.item);
      break;
    case "turn.completed":
      console.log("usage", event.usage);
      break;
  }
}
```

### Structured output

The Codex agent can produce a JSON response that conforms to a specified schema. The schema can be provided for each turn as a plain JSON object.

```typescript
const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    status: { type: "string", enum: ["ok", "action_required"] },
  },
  required: ["summary", "status"],
  additionalProperties: false,
} as const;

const turn = await thread.run("Summarize repository status", { outputSchema: schema });
console.log(turn.finalResponse);
```

You can also create a JSON schema from a [Zod schema](https://github.com/colinhacks/zod) using the [`zod-to-json-schema`](https://www.npmjs.com/package/zod-to-json-schema) package and setting the `target` to `"openAi"`.

```typescript
const schema = z.object({
  summary: z.string(),
  status: z.enum(["ok", "action_required"]),
});

const turn = await thread.run("Summarize repository status", {
  outputSchema: zodToJsonSchema(schema, { target: "openAi" }),
});
console.log(turn.finalResponse);
```

### Attaching images

Provide structured input entries when you need to include images alongside text. Text entries are concatenated into the final prompt while image entries are passed to the Codex CLI via `--image`.

```typescript
const turn = await thread.run([
  { type: "text", text: "Describe these screenshots" },
  { type: "local_image", path: "./ui.png" },
  { type: "local_image", path: "./diagram.jpg" },
]);
```

### Resuming an existing thread

Threads are persisted in `~/.codex/sessions`. If you lose the in-memory `Thread` object, reconstruct it with `resumeThread()` and keep going.

```typescript
const savedThreadId = process.env.CODEX_THREAD_ID!;
const thread = codex.resumeThread(savedThreadId);
await thread.run("Implement the fix");
```

### Working directory controls

Codex runs in the current working directory by default. To avoid unrecoverable errors, Codex requires the working directory to be a Git repository. You can skip the Git repository check by passing the `skipGitRepoCheck` option when creating a thread.

```typescript
const thread = codex.startThread({
  workingDirectory: "/path/to/project",
  skipGitRepoCheck: true,
});
```

### Controlling the Codex CLI environment

By default, the Codex CLI inherits the Node.js process environment. Provide the optional `env` parameter when instantiating the
`Codex` client to fully control which variables the CLI receives—useful for sandboxed hosts like Electron apps.

```typescript
const codex = new Codex({
  env: {
    PATH: "/usr/local/bin",
  },
});
```

The SDK still injects its required variables (such as `OPENAI_BASE_URL` and `CODEX_API_KEY`) on top of the environment you
provide.

### Passing `--config` overrides

Use the `config` option to provide additional Codex CLI configuration overrides. The SDK accepts a JSON object, flattens it
into dotted paths, and serializes values as TOML literals before passing them as repeated `--config key=value` flags.

```typescript
const codex = new Codex({
  config: {
    show_raw_agent_reasoning: true,
    sandbox_workspace_write: { network_access: true },
  },
});
```

Thread options still take precedence for overlapping settings because they are emitted after these global overrides.
