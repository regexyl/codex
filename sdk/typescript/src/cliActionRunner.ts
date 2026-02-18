import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { CodexConfigObject } from "./codexOptions";
import { resolveCodexBinaryPath } from "./codexBinary";
import { serializeConfigOverrides } from "./configOverrides";

const INTERNAL_ORIGINATOR_ENV = "CODEX_INTERNAL_ORIGINATOR_OVERRIDE";
const TYPESCRIPT_SDK_ORIGINATOR = "codex_sdk_ts";

export type CliActionRunnerOptions = {
  codexPathOverride?: string;
  config?: CodexConfigObject;
  env?: Record<string, string>;
  baseUrl?: string;
  apiKey?: string;
};

export type RunCliActionOptions = {
  args: string[];
  stdin?: string;
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  throwOnNonZero?: boolean;
};

export type CliActionResult = {
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

export class CliActionRunner {
  private readonly executablePath: string;
  private readonly configOverrides: CodexConfigObject | undefined;
  private readonly envOverride: Record<string, string> | undefined;
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;

  constructor(options: CliActionRunnerOptions = {}) {
    this.executablePath = resolveCodexBinaryPath(options.codexPathOverride ?? null);
    this.configOverrides = options.config;
    this.envOverride = options.env;
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
  }

  async run(options: RunCliActionOptions): Promise<CliActionResult> {
    if (!options.args.length) {
      throw new Error("RunCliActionOptions.args must contain at least one CLI argument");
    }

    const args = this.configOverrides
      ? [...serializeConfigOverrides(this.configOverrides).flatMap((value) => ["--config", value]), ...options.args]
      : [...options.args];

    const child = spawn(this.executablePath, args, {
      env: this.buildEnv(),
      cwd: options.cwd,
      signal: options.signal,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
    }
    if (child.stdin) {
      if (options.stdin !== undefined) {
        child.stdin.write(options.stdin);
      }
      child.stdin.end();
    }

    let timeout: NodeJS.Timeout | null = null;
    try {
      const exitPromise = waitForChildExit(child, args);
      const timeoutPromise =
        options.timeoutMs && options.timeoutMs > 0
          ? new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                if (!child.killed) {
                  child.kill();
                }
                const command = args.join(" ");
                reject(new Error(`Timed out waiting for codex command: ${command}`));
              }, options.timeoutMs);
            })
          : null;
      const waitForExit = timeoutPromise
        ? await Promise.race([exitPromise, timeoutPromise])
        : await exitPromise;

      const result: CliActionResult = {
        args,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: waitForExit.code,
        signal: waitForExit.signal,
      };

      if (options.throwOnNonZero && (result.exitCode !== 0 || result.signal)) {
        const detail = result.signal
          ? `signal ${result.signal}`
          : `exit code ${result.exitCode ?? 1}`;
        throw new Error(`Codex CLI action failed with ${detail}: ${result.stderr}`);
      }

      return result;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private buildEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    if (this.envOverride) {
      Object.assign(env, this.envOverride);
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
    if (this.baseUrl) {
      env.OPENAI_BASE_URL = this.baseUrl;
    }
    if (this.apiKey) {
      env.CODEX_API_KEY = this.apiKey;
    }
    return env;
  }
}

async function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  args: string[],
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
      });
    },
  );
  const errorPromise = new Promise<never>((_, reject) => {
    child.once("error", (error) => {
      const command = args.join(" ");
      reject(new Error(`Failed to spawn codex command (${command}): ${String(error)}`));
    });
  });

  return Promise.race([exitPromise, errorPromise]);
}
