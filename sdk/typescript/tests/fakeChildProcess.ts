import { EventEmitter } from "node:events";
import readline from "node:readline";
import { PassThrough } from "node:stream";

type SentMessageHandler = (message: unknown) => void | Promise<void>;

export class FakeChildProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  sentMessages: unknown[] = [];
  private stdinReader: readline.Interface;

  constructor(onSentMessage?: SentMessageHandler) {
    super();
    this.stdinReader = readline.createInterface({
      input: this.stdin,
      crlfDelay: Infinity,
    });
    void this.consumeStdin(onSentMessage);
  }

  emitStdoutMessage(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  emitExit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, signal);
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    setImmediate(() => {
      this.emitExit(null, signal ?? "SIGTERM");
    });
    return true;
  }

  private async consumeStdin(onSentMessage?: SentMessageHandler): Promise<void> {
    for await (const line of this.stdinReader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      this.sentMessages.push(parsed);
      if (onSentMessage) {
        await onSentMessage(parsed);
      }
    }
  }
}

export async function flushAsyncEvents(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
