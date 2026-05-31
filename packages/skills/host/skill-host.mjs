// Isolated skill host. Runs in a child process (separate memory + scrubbed env)
// and brokers EVERY capability back to the parent over IPC. Plugin code can only
// touch the host through the `ctx` API below, which proxies to the parent's
// permission engine + manifest enforcement. Plain JS so it runs under `node`
// directly with no transpile step inside the sandbox.

import { pathToFileURL } from "node:url";

const entry = process.argv[2];
let capSeq = 0;
const pending = new Map();

function requestCapability(op, args) {
  return new Promise((resolve) => {
    const id = ++capSeq;
    pending.set(id, resolve);
    process.send({ type: "cap", id, op, args });
  });
}

// The capability API handed to plugin tools. Each call is brokered + audited.
const ctx = {
  async readFile(path) {
    const r = await requestCapability("readFile", { path });
    if (!r.ok) throw new Error(r.error || "readFile denied");
    return r.data;
  },
  async writeFile(path, content) {
    const r = await requestCapability("writeFile", { path, content });
    if (!r.ok) throw new Error(r.error || "writeFile denied");
  },
  async exec(command) {
    const r = await requestCapability("exec", { command });
    if (!r.ok) throw new Error(r.error || "exec denied");
    return r.data;
  },
  async fetch(url, init) {
    const r = await requestCapability("fetch", { url, init });
    if (!r.ok) throw new Error(r.error || "fetch denied");
    return r.data;
  },
  log(message) {
    process.send({ type: "log", message: String(message) });
  },
};

let toolsPromise;
async function getTools() {
  if (!toolsPromise) {
    toolsPromise = import(pathToFileURL(entry).href).then((mod) => mod.tools ?? {});
  }
  return toolsPromise;
}

process.on("message", async (msg) => {
  if (msg.type === "cap-result") {
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
    return;
  }
  if (msg.type === "invoke") {
    try {
      const tools = await getTools();
      const handler = tools[msg.tool];
      if (typeof handler !== "function") {
        process.send({ type: "error", message: `no such tool: ${msg.tool}` });
        return;
      }
      const result = await handler(msg.input ?? {}, ctx);
      process.send({
        type: "result",
        ok: result?.ok !== false,
        content: typeof result?.content === "string" ? result.content : JSON.stringify(result ?? {}),
      });
    } catch (err) {
      process.send({ type: "error", message: err?.message ?? String(err) });
    }
  }
});
