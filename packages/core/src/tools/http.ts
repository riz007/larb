import type { Tool, ToolContext, ToolResult } from "./types.js";

const MAX_BODY_BYTES = 256 * 1024;

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * The agent's single governed network path. Egress is default-deny: every fetch
 * requires the `net` capability for the target host, so the user approves (and
 * the audit log records) exactly which hosts the agent may reach — the SPEC's
 * "network egress allow-listed per run" (§7.3/§9). Shell commands get no network
 * under the container backend (`--network none`); this tool is how the agent
 * does HTTP deliberately rather than via an unrestricted `curl`.
 */
export const httpFetchTool: Tool = {
  name: "http_fetch",
  description:
    "Fetch a URL over HTTP(S). Requires per-host network approval (default-deny). " +
    "Use for docs/APIs the task needs; prefer this over shelling out to curl/wget.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL" },
      method: { type: "string", description: "HTTP method (default GET)" },
      reason: { type: "string", description: "Why this request is needed" },
    },
    required: ["url"],
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const url = String(input.url ?? "");
    const method = String(input.method ?? "GET").toUpperCase();
    const host = safeHost(url);
    if (!host) {
      return { ok: false, content: `Invalid URL: ${url}`, summary: "http_fetch: invalid URL" };
    }

    await ctx.permission.require({
      capability: "net",
      host,
      reason: `http_fetch ${method} ${url}${input.reason ? ` — ${String(input.reason)}` : ""}`,
    });

    try {
      const res = await fetch(url, { method });
      const body = (await res.text()).slice(0, MAX_BODY_BYTES);
      const out = `HTTP ${res.status} ${res.statusText}\n${body}`;
      return {
        ok: res.ok,
        content: out,
        summary: `http_fetch ${method} ${host} → ${res.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        content: `Request failed: ${(err as Error).message}`,
        summary: `http_fetch ${host} → error`,
      };
    }
  },
};
