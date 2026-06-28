import type { PermissionEngine } from "@larb/governors";
import { McpClient } from "./client.js";
import { StdioTransport, type Transport } from "./transport.js";
import type { McpServerConfig, McpToolDescriptor, PreparedMcpTool } from "./types.js";

export interface McpManagerDeps {
  permission: PermissionEngine;
  /** Surface diagnostics (connection notes, server stderr) to the UI. */
  onNote?: (note: string) => void;
  /** Factory override for tests; defaults to a real stdio transport. */
  transportFactory?: (config: McpServerConfig, onStderr: (line: string) => void) => Transport;
}

interface ConnectedServer {
  config: McpServerConfig;
  client: McpClient;
  tools: McpToolDescriptor[];
}

/** Sanitize a name segment to the provider tool-name charset `[A-Za-z0-9_-]`. */
function sanitize(part: string): string {
  return part.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** `mcp__<server>__<tool>`, clamped to the 64-char provider tool-name limit. */
export function toolName(server: string, tool: string): string {
  return `mcp__${sanitize(server)}__${sanitize(tool)}`.slice(0, 64);
}

/**
 * Owns the lifecycle of every configured MCP server: connect, expose remote
 * tools as permission-gated Larb tools, and tear the child processes down.
 *
 * Every remote tool call requires the `mcp` capability scoped to the server, so
 * the user approves (and the audit log records) exactly which servers the agent
 * may reach — and the result re-enters the model through the orchestrator's
 * untrusted-output guard like any other tool.
 */
export class McpManager {
  private readonly connected: ConnectedServer[] = [];

  constructor(
    private readonly servers: McpServerConfig[],
    private readonly deps: McpManagerDeps,
  ) {}

  /** Connect to every configured server. A per-server failure is logged, not fatal. */
  async connectAll(): Promise<void> {
    for (const config of this.servers) {
      try {
        if (config.transport && config.transport !== "stdio") {
          throw new Error(`unsupported transport "${config.transport}" (v1 is stdio only)`);
        }
        const transport =
          this.deps.transportFactory?.(config, (l) => this.note(config.name, l)) ??
          new StdioTransport(config, (l) => this.note(config.name, l));
        const client = new McpClient(transport);
        await client.initialize();
        const tools = await client.listTools();
        this.connected.push({ config, client, tools });
        this.deps.onNote?.(
          `MCP "${config.name}" connected — ${tools.length} tool(s).`,
        );
      } catch (err) {
        this.deps.onNote?.(
          `MCP "${config.name}" failed to connect: ${(err as Error).message}`,
        );
      }
    }
  }

  /** Registry-ready, permission-gated wrappers for every connected tool. */
  tools(): PreparedMcpTool[] {
    const out: PreparedMcpTool[] = [];
    for (const server of this.connected) {
      for (const descriptor of server.tools) {
        out.push(this.wrap(server, descriptor));
      }
    }
    return out;
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.connected.map((s) => s.client.close().catch(() => {})));
    this.connected.length = 0;
  }

  private wrap(server: ConnectedServer, descriptor: McpToolDescriptor): PreparedMcpTool {
    const { name: serverName } = server.config;
    const remoteName = descriptor.name;
    const desc = descriptor.description?.trim() || "(no description)";
    return {
      name: toolName(serverName, remoteName),
      description: `[mcp: ${serverName}] ${desc}`,
      inputSchema:
        descriptor.inputSchema && typeof descriptor.inputSchema === "object"
          ? descriptor.inputSchema
          : { type: "object", properties: {} },
      execute: async (input) => {
        await this.deps.permission.require({
          capability: "mcp",
          host: serverName,
          command: remoteName,
          reason: `MCP ${serverName}.${remoteName} — ${desc}`,
        });
        try {
          const r = await server.client.callTool(remoteName, input);
          return {
            ok: r.ok,
            content: r.text,
            summary: `mcp ${serverName}.${remoteName} → ${r.ok ? "ok" : "error"}`,
          };
        } catch (err) {
          return {
            ok: false,
            content: `MCP call failed: ${(err as Error).message}`,
            summary: `mcp ${serverName}.${remoteName} → error`,
          };
        }
      },
    };
  }

  private note(server: string, line: string): void {
    this.deps.onNote?.(`MCP "${server}": ${line}`);
  }
}
