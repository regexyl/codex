import * as child_process from "node:child_process";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { CliActionRunner } from "../src/cliActionRunner";

import { FakeChildProcess } from "./fakeChildProcess";

jest.mock("node:child_process", () => {
  const actual = jest.requireActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: jest.fn() };
});

const _actualChildProcess =
  jest.requireActual<typeof import("node:child_process")>("node:child_process");
const spawnMock = child_process.spawn as jest.MockedFunction<typeof _actualChildProcess.spawn>;

describe("CliActionRunner", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("captures stdout and stderr from codex commands", async () => {
    const fakeProcess = new FakeChildProcess();
    spawnMock.mockReturnValue(fakeProcess as unknown as child_process.ChildProcess);

    setImmediate(() => {
      fakeProcess.stdout.write("ok\n");
      fakeProcess.stderr.write("warn\n");
      fakeProcess.emitExit(0, null);
    });

    const runner = new CliActionRunner({ codexPathOverride: "codex" });
    const result = await runner.run({
      args: ["features", "list"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok\n");
    expect(result.stderr).toBe("warn\n");
  });

  it("throws on non-zero exits when throwOnNonZero is true", async () => {
    const fakeProcess = new FakeChildProcess();
    spawnMock.mockReturnValue(fakeProcess as unknown as child_process.ChildProcess);

    setImmediate(() => {
      fakeProcess.stderr.write("failed\n");
      fakeProcess.emitExit(2, null);
    });

    const runner = new CliActionRunner({ codexPathOverride: "codex" });
    await expect(
      runner.run({
        args: ["mcp", "list"],
        throwOnNonZero: true,
      }),
    ).rejects.toThrow(/exit code 2/);
  });

  it("times out long-running commands", async () => {
    const fakeProcess = new FakeChildProcess();
    spawnMock.mockReturnValue(fakeProcess as unknown as child_process.ChildProcess);

    const runner = new CliActionRunner({ codexPathOverride: "codex" });
    await expect(
      runner.run({
        args: ["cloud", "list"],
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/Timed out waiting for codex command/);
  });
});
