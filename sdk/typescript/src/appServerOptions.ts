import type { CodexConfigObject } from "./codexOptions";
import type { AppServerServerRequestHandlers } from "./appServerTypes";

export type AppServerOptions = {
  codexPathOverride?: string;
  /**
   * Additional `--config key=value` overrides to pass to `codex app-server`.
   */
  config?: CodexConfigObject;
  /**
   * Environment variables passed to the `codex app-server` process.
   * When provided, the SDK will not inherit variables from `process.env`.
   */
  env?: Record<string, string>;
  /**
   * Optional OpenAI base URL override for the child process.
   */
  baseUrl?: string;
  /**
   * Optional API key override for the child process.
   *
   * For ChatGPT subscription flows this is usually omitted.
   */
  apiKey?: string;
  /**
   * Request timeout in milliseconds for JSON-RPC method calls.
   * Set to 0 or undefined to disable request timeouts.
   */
  requestTimeoutMs?: number;
  /**
   * Optional additional CLI args appended after `app-server`.
   */
  appServerArgs?: string[];
  /**
   * Initialize request payload settings.
   */
  initialize?: {
    clientInfo?: {
      name?: string;
      title?: string | null;
      version?: string;
    };
    capabilities?: {
      experimentalApi?: boolean;
      optOutNotificationMethods?: string[] | null;
    } | null;
  };
  /**
   * Optional handlers for server-initiated requests.
   */
  serverRequests?: AppServerServerRequestHandlers;
};
