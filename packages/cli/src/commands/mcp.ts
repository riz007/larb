import { loadConfig } from "@larb/core";
import { McpManager } from "@larb/mcp";
import type { PermissionEngine } from "@larb/governors";

/**
 * Inspect configured MCP servers.
 *
 *   larb mcp            list servers from your global config (offline, no spawn)
 *   larb mcp probe [n]  connect to servers (all, or one named) and list tools
 *
 * MCP servers come from TRUSTED global config only; `list` reads that config and
 * spawns nothing. `probe` is an explicit diagnostic that does start the servers
 * (initialize + tools/list — no tool is invoked) so you can see what they offer.
 */
export function mcpCommand(cwd: string, args: string[]): void {
  const sub = args[0];
  if (sub === "probe") {
    void probe(cwd, args[1]);
    return;
  }
  list(cwd);
}

function list(cwd: string): void {
  const servers = loadConfig(cwd).mcp;
  if (servers.length === 0) {
    console.log("No MCP servers configured.");
    console.log("Add [[mcp]] blocks to ~/.larb/config.toml (see config.example.toml).");
    console.log("Then run `larb mcp probe` to connect and list their tools.");
    return;
  }
  console.log(`Configured MCP servers (${servers.length}):\n`);
  for (const s of servers) {
    const cmd = [s.command, ...(s.args ?? [])].join(" ");
    const envKeys = Object.keys(s.env ?? {});
    console.log(`  ${s.name}`);
    console.log(`    transport: ${s.transport ?? "stdio"}`);
    console.log(`    command:   ${cmd}`);
    if (envKeys.length) console.log(`    env:       ${envKeys.join(", ")}`);
  }
  console.log("\nRun `larb mcp probe` to connect and list each server's tools.");
}

async function probe(cwd: string, only?: string): Promise<void> {
  let servers = loadConfig(cwd).mcp;
  if (only) {
    servers = servers.filter((s) => s.name === only);
    if (servers.length === 0) {
      console.error(`No MCP server named "${only}" in your global config.`);
      process.exitCode = 1;
      return;
    }
  }
  if (servers.length === 0) {
    console.log("No MCP servers configured. See `larb mcp`.");
    return;
  }

  // probe never invokes a tool, so a permissive stub is sufficient — the
  // permission engine gates calls, which only happen inside a run.
  const permission = { require: async () => {} } as unknown as PermissionEngine;
  const manager = new McpManager(servers, {
    permission,
    onNote: (n) => console.log(`  · ${n}`),
  });

  console.log(`Probing ${servers.length} MCP server(s)…\n`);
  try {
    await manager.connectAll();
    const tools = manager.tools();
    if (tools.length === 0) {
      console.log("\nNo tools discovered (check the notes above for connection errors).");
      return;
    }
    console.log(`\nDiscovered ${tools.length} tool(s):\n`);
    for (const t of tools) {
      console.log(`  ${t.name}`);
      console.log(`    ${t.description}`);
    }
  } catch (err) {
    console.error(`Probe failed: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await manager.closeAll();
  }
}
