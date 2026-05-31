import { useEffect, useRef, useState } from "react";
import { Box, Text, Static, useApp, useInput, render } from "ink";
import { TrustEngine, type Approver, type Decision, type PermissionRequest } from "@larb/governors";
import type { RunMode } from "@larb/core";
import { buildSession, type SessionCallbacks } from "../wiring.js";

interface Entry {
  id: number;
  kind:
    | "header"
    | "assistant"
    | "tool"
    | "tool-ok"
    | "tool-err"
    | "verify-ok"
    | "verify-err"
    | "diff"
    | "error"
    | "summary"
    | "note";
  text: string;
}

interface SelectOption {
  label: string;
  value: string;
}

type Pending =
  | { kind: "trust"; prompt: string; options: SelectOption[]; resolve: (v: string) => void }
  | { kind: "approval"; request: PermissionRequest; resolve: (v: Decision) => void };

const KIND_COLOR: Record<Entry["kind"], string | undefined> = {
  header: "magenta",
  assistant: undefined,
  tool: "blue",
  "tool-ok": "green",
  "tool-err": "red",
  "verify-ok": "green",
  "verify-err": "red",
  diff: undefined,
  error: "red",
  summary: "magenta",
  note: "yellow",
};

export interface AppProps {
  mode: RunMode;
  task: string;
  projectRoot: string;
}

function App({ mode, task, projectRoot }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [streamText, setStreamText] = useState("");
  const [sessionUsd, setSessionUsd] = useState(0);
  const [limitUsd, setLimitUsd] = useState(0);
  const [providerLine, setProviderLine] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState(false);

  const idRef = useRef(0);
  const streamBuf = useRef("");
  const startedRef = useRef(false);

  const addEntry = (kind: Entry["kind"], text: string) =>
    setEntries((prev) => [...prev, { id: idRef.current++, kind, text }]);

  const flushStream = () => {
    if (streamBuf.current.trim()) addEntry("assistant", streamBuf.current.trimEnd());
    streamBuf.current = "";
    setStreamText("");
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void drive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const interactive = Boolean(process.stdin.isTTY);

  function askSelect(
    prompt: string,
    options: SelectOption[],
    nonInteractive: string,
  ): Promise<string> {
    if (!interactive) {
      addEntry("note", `Non-interactive terminal — defaulting to "${nonInteractive}". Use a TTY or \`larb trust\`.`);
      return Promise.resolve(nonInteractive);
    }
    return new Promise<string>((resolve) => {
      setPending({
        kind: "trust",
        prompt,
        options,
        resolve: (v) => {
          setPending(null);
          resolve(v);
        },
      });
    });
  }

  const approver: Approver = (request) => {
    flushStream();
    if (!interactive) {
      addEntry("note", "Non-interactive terminal — denying capability request.");
      return Promise.resolve<Decision>("deny");
    }
    return new Promise<Decision>((resolve) => {
      setPending({
        kind: "approval",
        request,
        resolve: (v) => {
          setPending(null);
          resolve(v);
        },
      });
    });
  };

  const callbacks: SessionCallbacks = {
    onText: (delta) => {
      streamBuf.current += delta;
      setStreamText(streamBuf.current);
    },
    onToolStart: (name, input) => {
      flushStream();
      addEntry("tool", `→ ${name}  ${summarizeInput(name, input)}`);
    },
    onToolResult: (summary, ok) => addEntry(ok ? "tool-ok" : "tool-err", `  ${ok ? "✓" : "✗"} ${summary}`),
    onVerify: (command, ok) => addEntry(ok ? "verify-ok" : "verify-err", `  verify ${ok ? "✓" : "✗"} ${command}`),
    onCost: (usd) => setSessionUsd(usd),
    onDiff: (path, diff) => addEntry("diff", `diff — ${path}\n${diff}`),
    onNote: (note) => addEntry("note", note),
  };

  async function drive(): Promise<void> {
    try {
      const trust = new TrustEngine();
      const status = trust.status(projectRoot);
      const needFull = mode === "run";
      const enough = status && (needFull ? status.scope === "full" : true);
      if (!enough) {
        const value = await askSelect(
          `Trust this directory? Larb has read no config and made no network calls yet.\n  ${projectRoot}`,
          needFull
            ? [
                { label: "Trust — full (allow writes & commands)", value: "full" },
                { label: "Deny", value: "deny" },
              ]
            : [
                { label: "Trust — read-only", value: "read-only" },
                { label: "Deny", value: "deny" },
              ],
          "deny",
        );
        if (value === "deny") {
          addEntry("error", "Trust denied. Nothing was read, executed, or sent over the network.");
          return finish();
        }
        trust.trust(projectRoot, value as "read-only" | "full");
        addEntry("note", `Trusted ${projectRoot} (${value}).`);
      }

      addEntry("header", `Larb · ${mode} · ${task}`);

      let session;
      try {
        session = buildSession({ projectRoot, mode, approver, callbacks });
      } catch (err) {
        addEntry("error", (err as Error).message);
        return finish();
      }
      setLimitUsd(session.cost.snapshot().limits.perSession);

      const { label, orchestrator, worker } = session.provider;
      setProviderLine(
        orchestrator === worker
          ? `${label} · ${orchestrator}`
          : `${label} · ${orchestrator} / ${worker}`,
      );

      const result = await session.run(task);
      flushStream();
      addEntry(
        "summary",
        `Done in ${result.iterations} step(s) · edits: ${result.editsMade ? "yes" : "none"} · verification: ${result.verified}`,
      );
      finish();
    } catch (err) {
      flushStream();
      addEntry("error", (err as Error).message);
      finish();
    }
  }

  function finish(): void {
    setDone(true);
    setTimeout(() => exit(), 60);
  }

  return (
    <Box flexDirection="column">
      <Static items={entries}>{(item) => <EntryView key={item.id} entry={item} />}</Static>

      {streamText.trim() ? <Text>{streamText}</Text> : null}

      {pending?.kind === "trust" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">{pending.prompt}</Text>
          <Select options={pending.options} onSelect={pending.resolve} />
        </Box>
      ) : null}

      {pending?.kind === "approval" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">{describeRequest(pending.request)}</Text>
          <Select
            options={[
              { label: "Allow once", value: "allow-once" },
              { label: "Allow for this session", value: "allow-session" },
              { label: "Always allow (persist)", value: "always" },
              { label: "Deny", value: "deny" },
            ]}
            onSelect={(v) => pending.resolve(v as Decision)}
          />
        </Box>
      ) : null}

      {!done ? (
        <Box marginTop={1}>
          <Text dimColor>
            {providerLine ? `${providerLine}  ·  ` : ""}
            ${sessionUsd.toFixed(4)}
            {limitUsd ? ` / $${limitUsd.toFixed(2)} session limit` : ""}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function EntryView({ entry }: { entry: Entry }): JSX.Element {
  if (entry.kind === "diff") {
    const [headerLine, ...lines] = entry.text.split("\n");
    return (
      <Box flexDirection="column" marginY={1}>
        <Text color="cyan">{headerLine}</Text>
        {lines.map((line, i) => (
          <Text key={i} color={diffColor(line)}>
            {line}
          </Text>
        ))}
      </Box>
    );
  }
  return <Text color={KIND_COLOR[entry.kind]}>{entry.text}</Text>;
}

function Select({
  options,
  onSelect,
}: {
  options: SelectOption[];
  onSelect: (value: string) => void;
}): JSX.Element {
  const [index, setIndex] = useState(0);
  useInput((input, key) => {
    if (key.upArrow) setIndex((p) => (p - 1 + options.length) % options.length);
    else if (key.downArrow) setIndex((p) => (p + 1) % options.length);
    else if (key.return) onSelect(options[index]!.value);
    else if (/^[1-9]$/.test(input)) {
      const idx = Number(input) - 1;
      if (idx < options.length) onSelect(options[idx]!.value);
    }
  });
  return (
    <Box flexDirection="column">
      {options.map((o, i) => (
        <Text key={o.value} color={i === index ? "cyan" : undefined}>
          {i === index ? "❯ " : "  "}
          {i + 1}. {o.label}
        </Text>
      ))}
    </Box>
  );
}

function describeRequest(r: PermissionRequest): string {
  return `Permission requested: ${r.capability}${r.path ? ` on ${r.path}` : ""}${
    r.host ? ` to ${r.host}` : ""
  }\n  ${r.reason}`;
}

function summarizeInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "read_file":
    case "list_files":
      return String(input.path ?? input.dir ?? ".");
    case "write_file":
      return String(input.path ?? "");
    case "search_text":
      return `/${String(input.query ?? "")}/`;
    case "run_command":
      return String(input.command ?? "");
    default:
      return "";
  }
}

function diffColor(line: string): string | undefined {
  if (line.startsWith("+") && !line.startsWith("+++")) return "green";
  if (line.startsWith("-") && !line.startsWith("---")) return "red";
  if (line.startsWith("@@")) return "cyan";
  return undefined;
}

export function runInteractive(props: AppProps): void {
  render(<App {...props} />);
}
