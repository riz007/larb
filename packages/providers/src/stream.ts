/**
 * Read a fetch response body as a stream of text lines. Shared by the
 * OpenAI (SSE) and Ollama (NDJSON) adapters so incremental decoding lives in
 * one audited place. Works on the WHATWG ReadableStream that Node's `fetch`
 * returns.
 */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        yield buf.slice(0, nl);
        buf = buf.slice(nl + 1);
      }
    }
    const tail = buf.trim();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** Parse JSON, returning {} on failure (streamed tool-call args can be partial). */
export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}
