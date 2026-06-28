import type { Transport } from "./transport.js";
import type {
  JsonRpcMessage,
  JsonRpcResponse,
  McpToolDescriptor,
} from "./types.js";

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Text content blocks an MCP tool result may carry. */
interface McpContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface McpCallResult {
  ok: boolean;
  text: string;
}

/**
 * A JSON-RPC client speaking the MCP slice Larb needs: the initialize handshake
 * (initialize → notifications/initialized), tools/list, and tools/call. It
 * correlates responses to requests by id and times out stuck calls so a wedged
 * server can never hang the agent loop.
 */
export class McpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private fatal?: Error;

  constructor(
    private readonly transport: Transport,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    transport.onMessage((msg) => this.handleMessage(msg));
    transport.onError((err) => this.failAll(err));
  }

  /** Connect and complete the MCP initialize handshake. */
  async initialize(clientName = "larb", clientVersion = "0.1.0"): Promise<void> {
    await this.transport.start();
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: clientName, version: clientVersion },
    });
    // Per spec the client signals readiness with a notification (no response).
    this.transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = (await this.request("tools/list", {})) as
      | { tools?: McpToolDescriptor[] }
      | undefined;
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const result = (await this.request("tools/call", { name, arguments: args })) as
      | { content?: McpContentBlock[]; isError?: boolean }
      | undefined;
    const text = (result?.content ?? [])
      .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : JSON.stringify(b)))
      .join("\n")
      .trim();
    return { ok: !result?.isError, text: text || "(no content)" };
  }

  async close(): Promise<void> {
    this.failAll(new Error("client closed"));
    await this.transport.close();
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.fatal) return Promise.reject(this.fatal);
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.transport.send({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  private handleMessage(msg: JsonRpcMessage): void {
    // Notifications (no id) are ignored in v1.
    if (!("id" in msg) || typeof msg.id !== "number") return;
    const res = msg as JsonRpcResponse;
    const pending = this.pending.get(res.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(res.id);
    if (res.error) {
      pending.reject(new Error(`MCP error ${res.error.code}: ${res.error.message}`));
    } else {
      pending.resolve(res.result);
    }
  }

  private failAll(err: Error): void {
    this.fatal ??= err;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
