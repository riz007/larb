import { describe, it, expect } from "vitest";
import { assembleContent, parseTextToolCalls } from "./ollama.js";

const tools = new Set(["write_file", "read_file"]);

describe("parseTextToolCalls — recover text-emitted tool calls", () => {
  it("parses a bare JSON object (the observed qwen2.5-coder shape)", () => {
    const text = '{"name": "write_file", "arguments": {"path": "hello.txt", "content": "hi"}}';
    expect(parseTextToolCalls(text, tools)).toEqual([
      { name: "write_file", arguments: { path: "hello.txt", content: "hi" } },
    ]);
  });

  it("parses a <tool_call>-wrapped call", () => {
    const text = '<tool_call>\n{"name":"read_file","arguments":{"path":"a.ts"}}\n</tool_call>';
    expect(parseTextToolCalls(text, tools)).toEqual([
      { name: "read_file", arguments: { path: "a.ts" } },
    ]);
  });

  it("parses a ```json fenced call and accepts `parameters` as the args key", () => {
    const text = 'Sure:\n```json\n{"name":"write_file","parameters":{"path":"x"}}\n```';
    expect(parseTextToolCalls(text, tools)).toEqual([
      { name: "write_file", arguments: { path: "x" } },
    ]);
  });

  it("ignores JSON whose name is not a known tool (no false positives)", () => {
    const text = '{"name":"not_a_tool","arguments":{}}';
    expect(parseTextToolCalls(text, tools)).toEqual([]);
  });

  it("leaves ordinary prose alone", () => {
    expect(parseTextToolCalls("The add function returns a + b.", tools)).toEqual([]);
  });

  it("does nothing when no tools were offered", () => {
    const text = '{"name":"write_file","arguments":{"path":"x"}}';
    expect(parseTextToolCalls(text, new Set())).toEqual([]);
  });
});

describe("assembleContent", () => {
  it("prefers structured tool_calls and keeps any text", () => {
    const content = assembleContent(
      "ok",
      [{ function: { name: "write_file", arguments: { path: "y" } } }],
      tools,
    );
    expect(content).toEqual([
      { type: "text", text: "ok" },
      expect.objectContaining({ type: "tool_use", name: "write_file", input: { path: "y" } }),
    ]);
  });

  it("recovers a text-only tool call and drops the raw JSON text", () => {
    const content = assembleContent(
      '{"name":"write_file","arguments":{"path":"z"}}',
      [],
      tools,
    );
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: "tool_use", name: "write_file", input: { path: "z" } });
  });

  it("passes plain text through unchanged", () => {
    expect(assembleContent("just an answer", [], tools)).toEqual([
      { type: "text", text: "just an answer" },
    ]);
  });
});
