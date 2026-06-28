// A minimal MCP stdio server for tests. Speaks newline-delimited JSON-RPC 2.0:
// initialize → tools/list → tools/call, plus an `echo` and an erroring `boom`.
import { createInterface } from "node:readline";

// Exercise the transport's stderr path (must never be parsed as protocol).
process.stderr.write("mock-server: up\n");

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const TOOLS = [
  {
    name: "echo",
    description: "Echo the input text back",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  { name: "boom", description: "Always returns an error result" },
];

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  // Notifications carry no id and get no response.
  if (msg.id === undefined) return;

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mock", version: "0.0.0" },
      },
    });
  } else if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  } else if (msg.method === "tools/call") {
    const { name, arguments: args = {} } = msg.params ?? {};
    if (name === "echo") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: `echo: ${args.text}` }] },
      });
    } else if (name === "boom") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: "kaboom" }], isError: true },
      });
    } else {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `no tool ${name}` } });
    }
  } else {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
});
