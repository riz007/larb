import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GenerateRequest,
  GenerateResult,
  ModelProvider,
  StreamEvent,
} from "@larb/providers";
import type { CostGovernor, AuditLog } from "@larb/governors";
import { Orchestrator } from "./agent.js";
import { ToolRegistry } from "./tools/registry.js";
import { editFileTool } from "./tools/fs.js";
import { DEFAULT_CONFIG, type LarbConfig } from "./config.js";
import type { ToolContext } from "./tools/types.js";

/** A provider that replays scripted results and records every request. */
function scriptedProvider(results: GenerateResult["content"][]): {
  provider: ModelProvider;
  requests: GenerateRequest[];
} {
  const requests: GenerateRequest[] = [];
  let call = 0;
  const provider: ModelProvider = {
    name: "scripted",
    defaultModel: "test",
    async generate() {
      throw new Error("unused");
    },
    async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
      requests.push(request);
      const content = results[Math.min(call++, results.length - 1)]!;
      yield {
        type: "final",
        result: {
          model: "test",
          content,
          stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
          costUsd: 0,
        },
      };
    },
    async countTokens() {
      return 0;
    },
    estimateCost() {
      return 0;
    },
  };
  return { provider, requests };
}

function makeOpts(project: string, exitCode: number, config: LarbConfig) {
  const toolContext = {
    projectRoot: project,
    permission: { require: async () => {} },
    audit: { log: () => {} },
    sandbox: {
      run: async () => ({
        code: exitCode,
        stdout: "",
        stderr: exitCode === 0 ? "" : "TS2304: Cannot find name 'zz'",
        timedOut: false,
      }),
    },
    memory: { load: () => "", pathFor: () => join(project, ".larb/memory/x.md"), remember: () => {} },
  } as unknown as ToolContext;
  return {
    mode: "run" as const,
    model: "test",
    registry: new ToolRegistry([editFileTool]),
    toolContext,
    cost: { record: () => {}, snapshot: () => ({ sessionUsd: 0 }) } as unknown as CostGovernor,
    audit: { log: () => {} } as unknown as AuditLog,
    config,
    repoMap: "",
    memory: "",
  };
}

/** Text of the edit's tool_result as seen by the model in a follow-up request. */
function toolResultText(request: GenerateRequest): string {
  const block = request.messages
    .flatMap((m) => m.content)
    .find((b) => b.type === "tool_result");
  expect(block).toBeDefined();
  return (block as { content: string }).content;
}

const EDIT_THEN_DONE: GenerateResult["content"][] = [
  [
    {
      type: "tool_use",
      id: "t1",
      name: "edit_file",
      input: { path: "a.ts", old_string: "1", new_string: "2" },
    },
  ],
  [{ type: "text", text: "done" }],
];

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "larb-agent-"));
  writeFileSync(join(project, "a.ts"), "const x = 1;\n");
});

describe("orchestrator post-edit checks", () => {
  it("feeds failing diagnostics back in the same tool result", async () => {
    const { provider, requests } = scriptedProvider(EDIT_THEN_DONE);
    const config = { ...structuredClone(DEFAULT_CONFIG), check: ["tsc --noEmit"] };
    const result = await new Orchestrator().run({
      task: "bump the number",
      provider,
      ...makeOpts(project, 1, config),
    });

    expect(result.editsMade).toBe(true);
    // The follow-up model call carries the tool result; diagnostics ride along.
    const text = toolResultText(requests[1]!);
    expect(text).toContain("Diagnostics after this edit");
    expect(text).toContain("TS2304");
  });

  it("stays silent when checks pass", async () => {
    const { provider, requests } = scriptedProvider(EDIT_THEN_DONE);
    const config = { ...structuredClone(DEFAULT_CONFIG), check: ["tsc --noEmit"] };
    await new Orchestrator().run({
      task: "bump the number",
      provider,
      ...makeOpts(project, 0, config),
    });
    expect(toolResultText(requests[1]!)).not.toContain("Diagnostics");
  });

  it("runs no checks when none are configured", async () => {
    const { provider, requests } = scriptedProvider(EDIT_THEN_DONE);
    const config = structuredClone(DEFAULT_CONFIG); // check: []
    await new Orchestrator().run({
      task: "bump the number",
      provider,
      ...makeOpts(project, 1, config),
    });
    expect(toolResultText(requests[1]!)).not.toContain("Diagnostics");
  });
});
