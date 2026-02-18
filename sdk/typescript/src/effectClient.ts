import { Effect, Stream } from "effect";

import { AppServerClient } from "./appServerClient";
import { AppServerOptions } from "./appServerOptions";
import { AppServerNotification } from "./appServerTypes";
import { CliActionRunner, CliActionRunnerOptions, CliActionResult, RunCliActionOptions } from "./cliActionRunner";

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function appServerScoped(options: AppServerOptions = {}) {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: () => AppServerClient.connect(options),
      catch: toError,
    }),
    (client) =>
      Effect.tryPromise({
        try: () => client.close(),
        catch: toError,
      }).pipe(Effect.orDie),
  );
}

function callAppServer<Result = unknown, Params = unknown>(
  client: AppServerClient,
  method: string,
  params?: Params,
  requestTimeoutMs?: number,
) {
  return Effect.tryPromise({
    try: () => client.call<Result, Params>(method, params, requestTimeoutMs),
    catch: toError,
  });
}

function appServerNotifications(client: AppServerClient) {
  return Stream.fromAsyncIterable(client.notifications, toError) as Stream.Stream<
    AppServerNotification,
    Error
  >;
}

function closeAppServer(client: AppServerClient) {
  return Effect.tryPromise({
    try: () => client.close(),
    catch: toError,
  });
}

function cliRunnerScoped(options: CliActionRunnerOptions = {}) {
  return Effect.succeed(new CliActionRunner(options));
}

function runCliAction(runner: CliActionRunner, options: RunCliActionOptions) {
  return Effect.tryPromise({
    try: () => runner.run(options),
    catch: toError,
  }) as Effect.Effect<CliActionResult, Error>;
}

export const CodexEffect = {
  appServer: {
    scoped: appServerScoped,
    call: callAppServer,
    notifications: appServerNotifications,
    close: closeAppServer,
  },
  cli: {
    scoped: cliRunnerScoped,
    run: runCliAction,
  },
} as const;
