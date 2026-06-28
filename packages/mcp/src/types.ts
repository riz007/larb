/**
 * Types for Larb's Model Context Protocol client.
 *
 * Only the slice of MCP that v1 needs: the stdio transport, the initialize
 * handshake, and tools/list + tools/call. Resources, prompts, and the SSE/HTTP
 * transport are deliberately out of scope.
 */

/** A configured MCP server. Parsed from TRUSTED (global) config only. */
export interface McpServerConfig {
  /** Stable identifier used in the `mcp__<name>__<tool>` tool names and grants. */
  name: string;
  /** Transport kind. v1 supports stdio only. */
  transport?: "stdio";
  /** Executable to spawn (stdio). */
  command: string;
  /** Arguments for the command. */
  args?: string[];
  /**
   * Extra environment for the child. Values may reference host env with
   * `${VAR}` so secrets are not stored in plaintext config. Anything not listed
   * here (beyond a minimal PATH/HOME baseline) is withheld from the server.
   */
  env?: Record<string, string>;
}

/** A tool advertised by an MCP server (tools/list entry). */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** A Larb-side tool wrapper around a remote MCP tool, ready for the registry. */
export interface PreparedMcpTool {
  /** Sanitized `mcp__<server>__<tool>` name. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<{
    ok: boolean;
    content: string;
    summary: string;
  }>;
}

// ---- JSON-RPC 2.0 (the MCP wire format) ----

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification;
