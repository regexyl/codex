#!/usr/bin/env -S NODE_NO_WARNINGS=1 pnpm ts-node-esm --files

import { Effect } from "effect";

import { CodexEffect } from "@openai/codex-sdk";
import { codexPathOverride } from "./helpers.ts";

const program = Effect.scoped(
  Effect.gen(function* () {
    const runner = yield* CodexEffect.cli.scoped({
      codexPathOverride: codexPathOverride(),
    });

    const features = yield* CodexEffect.cli.run(runner, {
      args: ["features", "list"],
      throwOnNonZero: true,
    });

    console.log(features.stdout);
  }),
);

Effect.runPromise(program).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
